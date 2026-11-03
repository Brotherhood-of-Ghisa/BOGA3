const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { meaningful, approvalReference, acceptedCommentEntries } = require('./ui-design-acceptance');

const CATALOG = 'docs/specs/ui/components-catalog.md';
const PREFIX = 'apps/mobile/';
const implementationPath = value => /^apps\/mobile\/components\/[\w./-]+\.[jt]sx?$/.test(value ?? '') && path.posix.normalize(value) === value;
const productionPath = value => implementationPath(value) && /\.tsx?$/.test(value) && !value.startsWith('apps/mobile/components/pattern-gallery/');
const list = (value, predicate = meaningful) => Array.isArray(value) && value.length > 0 && value.every(predicate) && new Set(value).size === value.length;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}

// Includes proposal/evidence in the mutable PR body as well as the committed contract.
const promotionDigest = (template, proposal) => createHash('sha256').update(JSON.stringify(canonical({ template, proposal }))).digest('hex');
const templateDigest = template => promotionDigest(template, null);

function templateCatalog(text, legacyBase = false) {
  if (text == null) return [];
  const blocks = [...text.matchAll(/^```ui-template-catalog\s*\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length === 0 && legacyBase) return [];
  if (blocks.length !== 1) throw new Error('Catalog needs one ui-template-catalog JSON array.');
  const entries = JSON.parse(blocks[0][1]);
  if (!Array.isArray(entries)) throw new Error('ui-template-catalog must be an array.');
  const ids = new Set(), exports = new Set();
  for (const entry of entries) {
    const identity = `${entry.source}:${entry.export}`;
    if (!/^[A-Z]\w*$/.test(entry.id ?? '') || ids.has(entry.id) || exports.has(identity)) throw new Error('Template ids and production exports must be unique.');
    ids.add(entry.id); exports.add(identity);
    if (!productionPath(entry.source) || !/^[A-Z]\w*$/.test(entry.export ?? '') || !list(entry.uses) ||
      !entry.variants || Array.isArray(entry.variants) || typeof entry.variants !== 'object' || !Object.keys(entry.variants).length ||
      !Object.entries(entry.variants).every(([name, boundary]) => /^[\w-]+$/.test(name) && meaningful(boundary)) ||
      !['slots', 'typography', 'geometry', 'interactions', 'accessibility'].every(key => meaningful(entry[key])) ||
      !list(entry.files, implementationPath) || !entry.files.includes(entry.source) ||
      !/^apps\/mobile\/components\/pattern-gallery\/[\w./-]+\.tsx$/.test(entry.gallery?.source ?? '') ||
      !/^[A-Z]\w*$/.test(entry.gallery?.export ?? '') || !entry.files.includes(entry.gallery.source) ||
      !list(entry.tests, file => /^apps\/mobile\/__tests__\/[\w/-]+\.test\.tsx?$/.test(file))) {
      throw new Error(`Incomplete template contract: ${entry.id}. Include export, uses, bounded variants, slots, typography, geometry, interactions, accessibility, implementation files, gallery and tests.`);
    }
  }
  return entries;
}

function proposalError(proposal) {
  if (!['whyExistingInsufficient', 'differences', 'visualReference'].every(key => meaningful(proposal[key])) ||
    !approvalReference(proposal.preBuildApproval)) return 'promotion needs reuse rationale, differences, visual reference and separate pre-build human design/scope approval';
  const native = proposal.evidence?.native;
  if (!Array.isArray(native) || native.length < 2 || !native.every(item => meaningful(item.reference) && meaningful(item.device) && meaningful(item.viewport) && list(item.covers)) ||
    new Set(native.map(item => item.viewport)).size < 2 ||
    !['small', 'normal', 'content-extremes', 'states', 'interactions', 'accessibility'].every(scope => native.some(item => item.covers.includes(scope)))) {
    return 'promotion needs native references with devices/viewports covering small/normal sizes, content-extremes, states, interactions and accessibility';
  }
  return null;
}

function reviewTemplatePromotions({ rootDir, context, data, exported, usesParent, parentError }) {
  const violations = [], acceptedPaths = new Set();
  let templates = [];
  const report = rule => violations.push({ file: CATALOG, line: 1, rule });
  if (context.delegated || context.merged) return { violations, templates, acceptedPaths };
  try {
    const prior = templateCatalog(context.readBase?.(CATALOG), true);
    const target = path.resolve(rootDir, '../..', CATALOG);
    const current = templateCatalog(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null);
    // Only registrations already admitted to the trusted base are reusable.
    templates = prior.filter(entry => current.some(candidate => templateDigest(entry) === templateDigest(candidate)));
    const changed = current.filter(entry => !prior.some(base => templateDigest(entry) === templateDigest(base)));
    if (!changed.length && !data) return { violations, templates, acceptedPaths };
    if (!data) throw new Error('Provide one ui-pattern-selection JSON block for template promotions.');
    if (data.promotions !== undefined && !Array.isArray(data.promotions)) throw new Error('ui-pattern-selection.promotions must be an array.');
    const proposals = data.promotions ?? [];
    const seen = new Set();
    const accepted = changed.length && context.finalReview && /^[a-f0-9]{40}$/.test(context.head)
      ? acceptedCommentEntries(context, `UI template accepted at ${context.head}:`, /^- ([A-Z]\w* sha256:[a-f0-9]{64})$/) : new Set();
    for (const proposal of proposals) {
      const entry = changed.find(candidate => candidate.id === proposal?.id);
      if (!entry || seen.has(proposal.id)) { report('duplicate or out-of-diff template promotion'); continue; }
      seen.add(entry.id);
      const error = proposalError(proposal);
      if (error) report(`${entry.id}: ${error}`);
      const nearest = proposal.nearestParent;
      const declaredParent = nearest?.source !== entry.source && !parentError(rootDir, context, entry.source, nearest, false);
      if (!declaredParent) report(`${entry.id}: name a valid nearest existing production parent`);
      if (context.files.includes(entry.source) && !data.files?.some(record => record.path === entry.source && record.mode === 'custom' && record.parents?.some(parent => JSON.stringify(canonical(parent)) === JSON.stringify(canonical(nearest))))) report(`${entry.id}: novel implementation must declare custom design with its nearest parent`);
      for (const file of [...entry.files, ...entry.tests]) {
        if (!fs.existsSync(path.join(rootDir, file.slice(PREFIX.length)))) report(`${entry.id}: missing implementation/gallery/test file ${file}`);
      }
      const source = fs.readFileSync(path.join(rootDir, entry.source.slice(PREFIX.length)), 'utf8');
      const gallery = fs.readFileSync(path.join(rootDir, entry.gallery.source.slice(PREFIX.length)), 'utf8');
      if (!exported(source, entry.export) || !exported(gallery, entry.gallery.export) || !usesParent(rootDir, entry.gallery.source, entry)) report(`${entry.id}: production and representative gallery exports must exist; gallery must render the production export`);
      const key = `${entry.id} sha256:${promotionDigest(entry, proposal)}`;
      if (context.finalReview && !accepted.has(key)) report(`awaiting authorized human template promotion acceptance: UI template accepted at ${context.head}:\n- ${key}`);
      if (accepted.has(key) && !error && declaredParent) for (const file of entry.files) acceptedPaths.add(file);
    }
    for (const entry of changed) if (!seen.has(entry.id)) report(`${entry.id}: missing template promotion proposal (one-off design acceptance is insufficient)`);
  } catch (error) { report(error.message); }
  return { violations, templates, acceptedPaths };
}

function registeredTemplateError(templates, parent) {
  const entry = templates.find(template => template.source === parent.source && template.export === parent.export);
  if (!entry) return null;
  if (parent.family !== 'catalog' || parent.template !== entry.id || !entry.uses.includes(parent.use) || !Object.hasOwn(entry.variants, parent.variant)) {
    return 'promoted template reuse must name its catalog id, intended use and bounded variant; outside scope needs custom human acceptance';
  }
  return null;
}

module.exports = { CATALOG, templateCatalog, promotionDigest, reviewTemplatePromotions, registeredTemplateError };
