import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findUiPatternSelections } from '../scripts/ui-pattern-selection';
import { CATALOG, promotionDigest } from '../scripts/ui-template-promotion';
import { runUiGuardrailCheck } from '../scripts/check-ui-guardrails';

// Fictional contract and evidence: exercises the lifecycle without promoting a production design.
const head = 'a'.repeat(40);
const parent = { family: 'ListCard', source: 'apps/mobile/components/ui/list-card.tsx', export: 'ListCard' };
const approval = { by: 'human', reference: 'https://github.com/org/repo/pull/12#issuecomment-34' };
const template = () => ({
  id: 'FixturePanel', source: 'apps/mobile/components/ui/fixture-panel.tsx', export: 'FixturePanel',
  uses: ['status-summary'], variants: { passive: 'Read-only status; no row actions.' },
  slots: 'Required title, optional status text. No arbitrary interactive children.',
  typography: 'Shared body and caption roles; full accessible names.',
  geometry: 'Fixed token insets; wraps text on small phones; no density overrides.',
  interactions: 'Passive content only; navigation belongs to the containing screen.',
  accessibility: 'One grouped status announcement; no color-only information.',
  files: ['apps/mobile/components/ui/fixture-panel.tsx', 'apps/mobile/components/pattern-gallery/fixture-gallery.tsx'],
  gallery: { source: 'apps/mobile/components/pattern-gallery/fixture-gallery.tsx', export: 'FixtureGallery' },
  tests: ['apps/mobile/__tests__/fixture-panel.test.tsx'],
});
const proposal = () => ({
  id: 'FixturePanel', proposedBy: 'agent[bot]', whyExistingInsufficient: 'The nearest card owns board actions; status summaries are passive.',
  nearestParent: parent, differences: 'Bound passive status content in the existing token frame.',
  visualReference: 'https://github.com/org/repo/pull/12#fixture-reference', preBuildApproval: approval,
  evidence: { native: [
    { reference: 'https://github.com/org/repo/pull/12#fixture-small', device: 'iPhone SE', viewport: '375x667pt', covers: ['small', 'content-extremes', 'accessibility'] },
    { reference: 'https://github.com/org/repo/pull/12#fixture-normal', device: 'iPhone Pro', viewport: '402x874pt', covers: ['normal', 'states', 'interactions'] },
  ] },
});
let repo: string, rootDir: string, base: Record<string, string>;
const catalog = (entries: unknown[]) => `\`\`\`ui-template-catalog\n${JSON.stringify(entries)}\n\`\`\``;
const body = (files: unknown[], promotions: unknown[] = []) => `\`\`\`ui-pattern-selection\n${JSON.stringify({ files, promotions })}\n\`\`\``;
function write(file: string, source: string) {
  const target = path.join(repo, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
}
const custom = (file: string) => ({ path: file, mode: 'custom', parents: [parent], delta: 'Passive status derivation.' });
function context(overrides = {}) {
  return { files: [], body: body([], [proposal()]), head, finalReview: true, author: 'agent[bot]',
    comments: [], permissions: { human: 'write' }, readBase: (file: string) => base[file] ?? null, ...overrides };
}
const check = (overrides = {}) => findUiPatternSelections({ rootDir, selectionContext: context(overrides) });
const rules = (overrides = {}) => check(overrides).violations.map(item => item.rule);
const acceptance = (entry = template(), proposed = proposal(), extra = {}) => ({
  user: { login: 'human', type: 'User' }, body: `UI template accepted at ${head}:\n- ${entry.id} sha256:${promotionDigest(entry, proposed)}`, ...extra,
});
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-promotion-')); rootDir = path.join(repo, 'apps/mobile');
  base = {
    [CATALOG]: catalog([]),
    [parent.source]: 'export function ListCard(){return <View/>;}',
    [template().source]: 'export function FixturePanel(){return <View/>;}',
  };
  for (const [file, source] of Object.entries(base)) write(file, source);
  write(CATALOG, catalog([template()]));
  write(template().gallery.source, "import { FixturePanel } from '../ui/fixture-panel'; export function FixtureGallery(){return <FixturePanel/>;}");
  write(template().tests[0], 'test("fixture", () => {});');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

it('allows an agent proposal and separate authorized human promotion of an existing custom component', () => {
  for (const permission of ['write', 'maintain', 'admin']) {
    expect(check({ comments: [acceptance()], permissions: { human: permission } }).violations).toEqual([]);
  }
  expect(check({ author: 'human', comments: [acceptance()] }).violations).toEqual([]);
});

it('installs the empty catalog on a legacy base without promoting anything', () => {
  base[CATALOG] = '# Components Catalog\nExisting family inventory.';
  write(CATALOG, catalog([]));
  expect(rules({ body: '', comments: [] })).toEqual([]);
  write(CATALOG, base[CATALOG]);
  expect(rules({ body: '' })).toContainEqual(expect.stringContaining('one ui-template-catalog'));
});

it('reports the exact acceptance block for missing promotion, even with no changed JSX', () => {
  expect(rules()).toEqual([expect.stringContaining(`UI template accepted at ${head}:\n- FixturePanel sha256:${promotionDigest(template(), proposal())}`)]);
  expect(rules({ body: '' })).toContainEqual(expect.stringContaining('one ui-pattern-selection'));
  expect(rules({ body: body([]) })).toContainEqual(expect.stringContaining('missing template promotion proposal'));
});

it.each([
  { body: 'Approved. This component looks good.' },
  { body: `UI design accepted at ${head}:\n- ${template().source}` },
  { body: `UI template accepted at ${'b'.repeat(40)}:\n- FixturePanel sha256:${promotionDigest(template(), proposal())}` },
  { user: { login: 'agent[bot]', type: 'Bot' } },
  { body: `> UI template accepted at ${head}:\n> - FixturePanel sha256:${promotionDigest(template(), proposal())}` },
  { body: `\`\`\`text\n${acceptance().body}\n\`\`\`` },
  { body: `<!--\n${acceptance().body}\n-->` },
])('rejects one-off/generic/stale/bot/quoted promotion acceptance: %j', extra => {
  expect(rules({ comments: [acceptance(template(), proposal(), extra)] })).toContainEqual(expect.stringContaining('awaiting authorized human template promotion'));
});

it('rejects read/triage authority, removed comments and same-account bot identity', () => {
  for (const permission of ['read', 'triage']) expect(rules({ comments: [acceptance()], permissions: { human: permission } })).toHaveLength(1);
  expect(rules({ comments: [] })).toHaveLength(1);
  expect(rules({ comments: [acceptance(template(), proposal(), { user: { login: 'human', type: 'Bot' } })] })).toHaveLength(1);
});

it('binds acceptance to scope, evidence, proposal approval and full implementation commit', () => {
  const old = acceptance();
  write(CATALOG, catalog([{ ...template(), uses: ['another-use'] }]));
  expect(rules({ comments: [old] })).toHaveLength(1);
  write(CATALOG, catalog([template()]));
  for (const changed of [{ ...proposal(), differences: 'New geometry.' }, { ...proposal(), preBuildApproval: { ...approval, reference: `${approval.reference}-changed` } }, { ...proposal(), evidence: { native: proposal().evidence.native.map(item => ({ ...item, reference: `${item.reference}-changed` })) } }]) {
    expect(rules({ body: body([], [changed]), comments: [old] })).toHaveLength(1);
  }
  expect(rules({ head: 'b'.repeat(40), comments: [old] })).toHaveLength(1);
  expect(rules({ head: 'abc123', comments: [old] })).toHaveLength(1);
});

it('does not activate a candidate registration even when its promotion is accepted', () => {
  const file = 'apps/mobile/components/status.tsx';
  write(file, "import { FixturePanel } from './ui/fixture-panel'; export function Status(){return <FixturePanel/>;}");
  const selection = { path: file, mode: 'template', parents: [{ family: 'catalog', source: template().source, export: template().export, template: template().id, use: 'status-summary', variant: 'passive' }], delta: 'Reuse the passive status.' };
  expect(rules({ files: [file], body: body([selection], [proposal()]), comments: [acceptance()] })).toContainEqual(expect.stringContaining('not an approved design template'));
});

function reuse(overrides = {}) {
  base[CATALOG] = catalog([template()]);
  const file = 'apps/mobile/components/status.tsx';
  write(file, "import { FixturePanel } from './ui/fixture-panel'; export function Status(){return <FixturePanel/>;}");
  const selected = { family: 'catalog', source: template().source, export: template().export, template: template().id, use: 'status-summary', variant: 'passive', ...overrides };
  return { files: [file], body: body([{ path: file, mode: 'template', parents: [selected], delta: 'Reuse passive status within its accepted bounds.' }]) };
}
it('reuses an accepted merged-base template without new human acceptance', () => {
  const selectionContext = context(reuse());
  expect(findUiPatternSelections({ rootDir, selectionContext }).violations).toEqual([]);
  expect(runUiGuardrailCheck({ rootDir, selectionContext, stdout: { write() {} } }).ok).toBe(true);
});
it.each([{ use: 'unaccepted-use' }, { variant: 'interactive' }, { template: 'DifferentId' }, { family: 'ListCard' }])('requires a custom declaration outside promoted bounds: %j', overrides => {
  expect(rules(reuse(overrides))).toContainEqual(expect.stringContaining('outside scope needs a custom design declaration'));
});

it.each(['style={existingStyle}', 'contentStyle={existingStyle}', '{...props}', 'variant="interactive"', 'variant={choice}'])('rejects promoted-template override %s even with an unchanged imported style', attribute => {
  const selection = reuse();
  const file = selection.files[0];
  write('apps/mobile/components/existing-styles.ts', 'export const existingStyle = {fontSize: uiTypography.size.xl, padding: uiSpace.xl};');
  base['apps/mobile/components/existing-styles.ts'] = fs.readFileSync(path.join(repo, 'apps/mobile/components/existing-styles.ts'), 'utf8');
  write(file, `import { existingStyle } from './existing-styles'; import { FixturePanel as Chosen } from './ui/fixture-panel'; export function Status(){return <Chosen ${attribute}/>;}`);
  const selectionContext = context(selection);
  expect(findUiPatternSelections({ rootDir, selectionContext }).violations).toContainEqual(expect.objectContaining({ rule: expect.stringContaining('custom design declaration') }));
  expect(runUiGuardrailCheck({ rootDir, selectionContext, stdout: { write() {} } }).ok).toBe(false);
});

it('allows a literal accepted variant through a renamed production export', () => {
  const selection = reuse();
  write(selection.files[0], "import { FixturePanel as Chosen } from './ui/fixture-panel'; export function Status(){return <Chosen variant={'passive'}/>;}");
  expect(rules(selection)).toEqual([]);
});

it('allows multiple accepted variants of one export in the same consumer', () => {
  const selection = reuse();
  const entry = { ...template(), variants: { passive: 'Read-only status.', expanded: 'Read-only detail.' } };
  base[CATALOG] = catalog([entry]); write(CATALOG, base[CATALOG]);
  write(selection.files[0], "import { FixturePanel as Chosen } from './ui/fixture-panel'; export function Status(){return <><Chosen variant='passive'/><Chosen variant='expanded'/></>;}");
  const selected = { family: 'catalog', source: entry.source, export: entry.export, template: entry.id, use: entry.uses[0] };
  selection.body = body([{ path: selection.files[0], mode: 'template', parents: [{ ...selected, variant: 'passive' }, { ...selected, variant: 'expanded' }], delta: 'Reuse two accepted variants.' }]);
  expect(rules(selection)).toEqual([]);
});

it('checks proposed contract changes even when implementation is unchanged', () => {
  base[CATALOG] = catalog([template()]);
  const next = { ...template(), variants: { ...template().variants, dense: 'New bounded density.' } };
  write(CATALOG, catalog([next]));
  expect(rules({ comments: [acceptance()] })).toHaveLength(1);
  expect(rules({ comments: [acceptance(next)] })).toEqual([]);
});

it('requires template promotion acceptance separately from custom component declarations', () => {
  delete base[template().source];
  const files = template().files;
  const declarations = files.map(custom);
  expect(rules({ files, body: body(declarations, [proposal()]), comments: [acceptance()] })).toEqual([]);
  const other = 'apps/mobile/components/other.tsx'; write(other, 'export function Other(){return <View/>;}');
  expect(rules({ files: [...files, other], body: body([...declarations, custom(other)], [proposal()]), comments: [acceptance()] })).toEqual([]);
  expect(rules({ files, body: body(declarations, [proposal()]), comments: [] })).toEqual([expect.stringContaining('awaiting authorized human template promotion')]);
});

it('requires pre-build scope approval, native extremes/states/actions evidence and real gallery/test files', () => {
  expect(rules({ body: body([], [{ ...proposal(), preBuildApproval: undefined }]) })).toContainEqual(expect.stringContaining('pre-build human design/scope approval'));
  expect(rules({ body: body([], [{ ...proposal(), evidence: { native: proposal().evidence.native.slice(0, 1) } }]) })).toContainEqual(expect.stringContaining('native references'));
  fs.rmSync(path.join(repo, template().tests[0]));
  expect(rules()).toContainEqual(expect.stringContaining('missing implementation/gallery/test file'));
  write(template().gallery.source, 'export function FixtureGallery(){return <View/>;}');
  expect(rules()).toContainEqual(expect.stringContaining('gallery must render the production export'));
});

it('rejects invalid catalog contracts, duplicate identities and stale promotion records', () => {
  expect(rules({ body: body([], [proposal(), proposal()]) })).toContain('duplicate or out-of-diff template promotion');
  write(CATALOG, catalog([template(), template()])); expect(rules()).toContainEqual(expect.stringContaining('must be unique'));
  write(CATALOG, catalog([{ ...template(), source: 'apps/mobile/components/ui/fixture-panel.jsx' }])); expect(rules()).toContainEqual(expect.stringContaining('Incomplete template contract'));
  write(CATALOG, catalog([{ ...template(), geometry: 'TBD' }])); expect(rules()).toContainEqual(expect.stringContaining('Incomplete template contract'));
  write(CATALOG, catalog([{ ...template(), source: 'apps/mobile/components/../../untrusted.js' }])); expect(rules()).toContainEqual(expect.stringContaining('Incomplete template contract'));
  write(CATALOG, catalog([{ ...template(), source: 'apps/mobile/components/./pattern-gallery/fixture-gallery.tsx' }])); expect(rules()).toContainEqual(expect.stringContaining('Incomplete template contract'));
  write(CATALOG, catalog([])); expect(rules()).toEqual(['duplicate or out-of-diff template promotion']);
});

it('does not trust candidate-supplied acceptance metadata', () => {
  const candidate = { ...proposal(), comments: [acceptance()], permissions: { human: 'admin' } };
  expect(rules({ body: body([], [candidate]) })).toContainEqual(expect.stringContaining('awaiting authorized human template promotion'));
});

it('keeps digests stable across JSON key order, but binds content and array order', () => {
  expect(promotionDigest(Object.fromEntries(Object.entries(template()).reverse()), proposal())).toBe(promotionDigest(template(), proposal()));
  expect(promotionDigest({ ...template(), files: [...template().files].reverse() }, proposal())).not.toBe(promotionDigest(template(), proposal()));
});
