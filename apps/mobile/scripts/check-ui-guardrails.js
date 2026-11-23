#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { borderRule, edgeShadowRule, legacyVocabularyRule, rawColorLiteralRule, ratchetRules } = require('./ui-guardrails.config');
const { findCompactPatternViolations } = require('./compact-pattern-guardrail');
const { findListPatternViolations } = require('./list-pattern-guardrail');
const { findTablePatternViolations } = require('./table-pattern-guardrail');

const { findSummaryPatternViolations } = require('./summary-pattern-guardrail');

const RAW_COLOR_LITERAL_REGEX =
  /#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)/g;

const RAW_FONT_SIZE_REGEX = /\bfontSize:\s*(\d+(?:\.\d+)?)/g;

const RAW_SPACING_REGEX =
  /\b(?:padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingStart|paddingEnd|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginStart|marginEnd|marginHorizontal|marginVertical|gap|rowGap|columnGap):\s*(\d+(?:\.\d+)?)/g;

const RAW_RADIUS_REGEX =
  /\b(?:borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|borderTopStartRadius|borderTopEndRadius|borderBottomStartRadius|borderBottomEndRadius):\s*(\d+(?:\.\d+)?)/g;

// Ratchet rules: unlike the color rule (which is already at zero and blocks on
// sight), these start above zero. Each carries a budget equal to the count that
// exists today; the check fails when a change goes OVER it, and equally when a
// change goes UNDER it without lowering the budget — that is what makes the
// number only ever travel downwards. `--update-budgets` rewrites the config.
const RATCHET_RULE_DEFINITIONS = [
  {
    id: 'rawFontSize',
    title: 'raw fontSize literal scan (screens/components)',
    regex: RAW_FONT_SIZE_REGEX,
    remedy: 'use uiTypography.size.* from @/components/ui/tokens',
    skipZero: false,
  },
  {
    id: 'rawSpacing',
    title: 'raw spacing literal scan (screens/components)',
    regex: RAW_SPACING_REGEX,
    remedy: 'use uiSpace.* from @/components/ui/tokens',
    skipZero: true,
  },
  {
    id: 'rawRadius',
    title: 'raw border-radius literal scan (screens/components)',
    regex: RAW_RADIUS_REGEX,
    remedy: 'use uiGeometry.radius.* from @/components/ui/tokens',
    skipZero: true,
  },
];

// The retired styling vocabulary (`legacyVocabularyRule.identifiers` in the
// config), matched as whole words so `myUiColorsHelper` is not a hit, plus the
// keys of the retired `uiTokens` aggregate. Like the colour rule it blocks on
// sight: there is no budget and no allowlist. It scans wider than the other
// rules — `src/**` and `.ts` too — because the legacy tokens were used from
// style modules and `src/sync/SyncGate.tsx`, not only from screens.
function buildLegacyVocabularyRegex(identifiers = legacyVocabularyRule?.identifiers ?? []) {
  if (identifiers.length === 0) {
    throw new Error('legacyVocabularyRule.identifiers is empty in scripts/ui-guardrails.config.js');
  }
  return new RegExp(
    `\\b(?:${identifiers.join('|')})\\b|\\buiTokens\\.(?:colors|radius|elevation)\\b`,
    'g'
  );
}

const LEGACY_VOCABULARY_SCOPE = { targets: ['app', 'components', 'src'], extensions: ['.ts', '.tsx'] };

const LEGACY_VOCABULARY_REMEDY =
  'use useUiRoles() or a makeStyles sheet (colour) from @/components/ui, uiGeometry.radius (radii) from @/components/ui/tokens, and Card / Stat / ' +
  'ListRow / ActionButton / SegmentedControl / ChipGroup from @/components/ui for the retired primitives';

// A shadow set anywhere but the edge helper (`edgeShadowRule.ownerFile`): a
// `shadow*` style (`shadowColor`, `shadowOffset`…), a `boxShadow` or an
// Android `elevation`, as a style key or a prop. Depth is the ground ladder plus
// the one edge, so every card and control lifts the same way. Like the
// legacy rule it blocks on sight, scans `src/**` and `.ts` too, and has no
// budget or allowlist: the owner is the one file the edge lives in.
// `=` as a prop, never `==` / `===` (a comparison sets no style).
const EDGE_SHADOW_REGEX = /\b(?:shadow[A-Z]\w*|boxShadow|elevation)\s*(?::|=(?!=))/g;

const EDGE_SHADOW_REMEDY =
  'spread uiEdge / uiWell (or uiHairline) from @/components/ui into the style instead of setting a shadow';

// A container's own edge outside `components/ui` (`borderRule.ownerPrefix`): any
// `borderColor`, `borderWidth`, `border*Radius`, `borderStyle` or per-side
// `border*Width` / `border*Color` key, as a style key or an inline override.
// Exactly one shape passes — the row divider: a single-side `border<Side>Width`
// whose own object sets `border<Side>Color` to `ruleSoft` (a `0` width or radius is
// the absence of an edge). A card, field, pill or swatch edge lives in a
// primitive (`Card`, `Tag`, `ChipGroup`…), `uiEdge` / `uiHairline` or a
// `uiMark` shape, all under `components/ui`, so the rule needs no per-file list.
const BORDER_KEY_REGEX =
  /\b(border(?:Top|Bottom|Left|Right|Start|End|Horizontal|Vertical)?(?:Width|Color)|border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius|borderStyle)\b\s*:\s*([^,}\n]*)/g;

const BORDER_REMEDY =
  'draw a container with Card / Notice / Tag / ChipGroup / FormField from @/components/ui, a shape with uiMark, or a row divider as a single-side ' +
  'border<Side>Width with border<Side>Color: roles.ruleSoft';

const SINGLE_SIDE_WIDTH_REGEX = /^border(Top|Bottom|Left|Right|Start|End)Width$/;
const SINGLE_SIDE_COLOR_REGEX = /^border(Top|Bottom|Left|Right|Start|End)Color$/;
const RULE_SOFT_VALUE_REGEX = /^\w+\.ruleSoft$/;

// The `{ … }` that holds `index`: scan out to the unmatched braces on each side.
function enclosingObject(source, index) {
  let start = index;
  for (let depth = 0; start > 0; start -= 1) {
    const char = source[start - 1];
    if (char === '}') depth += 1;
    if (char === '{') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  let end = index;
  for (let depth = 0; end < source.length; end += 1) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return source.slice(start, end);
}

function isRowDividerKey(source, key, value, index) {
  if (/^0(?:\.0+)?$/.test(value)) return true;
  if (SINGLE_SIDE_COLOR_REGEX.test(key)) return RULE_SOFT_VALUE_REGEX.test(value);
  const side = SINGLE_SIDE_WIDTH_REGEX.exec(key)?.[1];
  if (!side) return false;
  return new RegExp(`\\bborder${side}Color\\s*:\\s*\\w+\\.ruleSoft\\b`).test(enclosingObject(source, index));
}

const UI_SCOPE = { targets: ['app', 'components'], extensions: ['.tsx'] };

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function collectUiFiles(rootDir, scope = UI_SCOPE) {
  const { targets } = scope;
  const results = [];

  for (const target of targets) {
    const absoluteTarget = path.join(rootDir, target);
    if (!fs.existsSync(absoluteTarget)) {
      continue;
    }

    walkDirectory(absoluteTarget, (absoluteFilePath) => {
      const relativePath = toPosixPath(path.relative(rootDir, absoluteFilePath));
      if (!isUiSourceFile(relativePath, scope)) {
        return;
      }

      results.push(relativePath);
    });
  }

  return results.sort();
}

function walkDirectory(directoryPath, onFile) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.expo') {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      walkDirectory(entryPath, onFile);
      continue;
    }

    if (entry.isFile()) {
      onFile(entryPath);
    }
  }
}

function isUiSourceFile(relativePath, { targets, extensions } = UI_SCOPE) {
  if (!targets.some((target) => relativePath.startsWith(`${target}/`))) {
    return false;
  }

  const extension = extensions.find((candidate) => relativePath.endsWith(candidate));
  if (!extension) {
    return false;
  }

  if (relativePath.includes('/__tests__/') || relativePath.includes('/__snapshots__/')) {
    return false;
  }

  if (['.test', '.spec', '.stories'].some((suffix) => relativePath.endsWith(`${suffix}${extension}`))) {
    return false;
  }

  return true;
}

function normalizeAllowlistEntries(allowlistedFiles = []) {
  const map = new Map();
  for (const entry of allowlistedFiles) {
    if (!entry || !entry.path) {
      continue;
    }

    map.set(toPosixPath(entry.path), entry.reason || 'No reason provided.');
  }
  return map;
}

// The shared scan every rule runs. `matchLiteral` turns one regex match into
// the literal string to report, or null to skip it (a spacing/radius `0` is the
// absence of the value, not a point on the scale).
function findViolations({
  rootDir,
  regex,
  matchLiteral,
  includeAllowlisted = false,
  allowlistedFiles = [],
  scope = UI_SCOPE,
} = {}) {
  const resolvedRootDir = rootDir || path.resolve(__dirname, '..');
  const allowlist = normalizeAllowlistEntries(allowlistedFiles);
  const files = collectUiFiles(resolvedRootDir, scope);

  const violations = [];
  const skippedAllowlistedFiles = [];

  for (const relativePath of files) {
    const allowlistReason = allowlist.get(relativePath);
    if (allowlistReason && !includeAllowlisted) {
      skippedAllowlistedFiles.push({ path: relativePath, reason: allowlistReason });
      continue;
    }

    const absolutePath = path.join(resolvedRootDir, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const lines = source.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const matches = [...line.matchAll(regex)];

      for (const match of matches) {
        const literal = matchLiteral(match);
        if (literal === null) {
          continue;
        }

        violations.push({
          file: relativePath,
          line: index + 1,
          literal,
          allowlisted: Boolean(allowlistReason),
          reason: allowlistReason || null,
          lineText: line.trim(),
        });
      }
    }
  }

  return {
    rootDir: resolvedRootDir,
    filesScanned: files.length,
    skippedAllowlistedFiles,
    violations,
    blockingViolations: violations.filter((violation) => !violation.allowlisted),
  };
}

function findRawColorLiteralViolations({
  rootDir,
  includeAllowlisted = false,
  allowlistedFiles = rawColorLiteralRule?.allowlistedFiles ?? [],
} = {}) {
  return findViolations({
    rootDir,
    regex: RAW_COLOR_LITERAL_REGEX,
    matchLiteral: (match) => match[0],
    includeAllowlisted,
    allowlistedFiles,
  });
}

function findLegacyVocabularyViolations({ rootDir, identifiers } = {}) {
  return findViolations({
    rootDir,
    regex: buildLegacyVocabularyRegex(identifiers),
    matchLiteral: (match) => match[0],
    scope: LEGACY_VOCABULARY_SCOPE,
  });
}

function findEdgeShadowViolations({ rootDir, ownerFile = edgeShadowRule?.ownerFile } = {}) {
  if (!ownerFile) {
    throw new Error('edgeShadowRule.ownerFile is not set in scripts/ui-guardrails.config.js');
  }
  const result = findViolations({
    rootDir,
    regex: EDGE_SHADOW_REGEX,
    matchLiteral: (match) => match[0],
    scope: LEGACY_VOCABULARY_SCOPE,
  });
  const violations = result.violations.filter((violation) => violation.file !== ownerFile);
  return { ...result, ownerFile, violations, blockingViolations: violations };
}

function findBorderViolations({ rootDir, ownerPrefix = borderRule?.ownerPrefix } = {}) {
  if (!ownerPrefix) {
    throw new Error('borderRule.ownerPrefix is not set in scripts/ui-guardrails.config.js');
  }
  const resolvedRootDir = rootDir || path.resolve(__dirname, '..');
  const files = collectUiFiles(resolvedRootDir, LEGACY_VOCABULARY_SCOPE);
  const violations = [];

  for (const relativePath of files) {
    if (relativePath.startsWith(ownerPrefix)) continue;
    const source = fs.readFileSync(path.join(resolvedRootDir, relativePath), 'utf8');
    const lines = source.split(/\r?\n/);
    for (const match of source.matchAll(BORDER_KEY_REGEX)) {
      const [literal, key, rawValue] = match;
      if (isRowDividerKey(source, key, rawValue.trim(), match.index)) continue;
      const lineNumber = source.slice(0, match.index).split('\n').length;
      violations.push({
        file: relativePath,
        line: lineNumber,
        literal: `${key}: ${rawValue.trim()}`.trim() || literal,
        allowlisted: false,
        reason: null,
        lineText: lines[lineNumber - 1].trim(),
      });
    }
  }

  return {
    rootDir: resolvedRootDir,
    filesScanned: files.length,
    skippedAllowlistedFiles: [],
    ownerPrefix,
    violations,
    blockingViolations: violations,
  };
}

function findRatchetRuleViolations({
  ruleId,
  rootDir,
  includeAllowlisted = false,
  allowlistedFiles,
} = {}) {
  const definition = RATCHET_RULE_DEFINITIONS.find((rule) => rule.id === ruleId);
  if (!definition) {
    throw new Error(`Unknown ratchet rule: ${ruleId}`);
  }

  const configured = ratchetRules?.[ruleId] ?? {};

  const result = findViolations({
    rootDir,
    regex: definition.regex,
    matchLiteral: (match) => {
      if (definition.skipZero && Number(match[1]) === 0) {
        return null;
      }
      return match[0];
    },
    includeAllowlisted,
    allowlistedFiles: allowlistedFiles ?? configured.allowlistedFiles ?? [],
  });

  return { ...result, ruleId, definition };
}

// A ratchet rule passes only when the blocking count EQUALS its budget. Over
// budget means the change added raw values; under budget means the change
// removed some and the budget must come down with them.
function evaluateRatchet(result, budget) {
  const count = result.blockingViolations.length;

  if (typeof budget !== 'number') {
    return { ok: false, count, budget: null, direction: 'missing' };
  }

  if (count > budget) {
    return { ok: false, count, budget, direction: 'over' };
  }

  if (count < budget) {
    return { ok: false, count, budget, direction: 'under' };
  }

  return { ok: true, count, budget, direction: 'equal' };
}

function formatViolationGroups(lines, violations) {
  const grouped = new Map();
  for (const violation of violations) {
    const group = grouped.get(violation.file) ?? [];
    group.push(violation);
    grouped.set(violation.file, group);
  }

  for (const [file, fileViolations] of grouped.entries()) {
    const fileLabel = fileViolations[0].allowlisted ? `${file} (allowlisted)` : file;
    lines.push(fileLabel);
    for (const violation of fileViolations.slice(0, 8)) {
      lines.push(`  L${violation.line}: ${violation.literal} -> ${violation.lineText}`);
    }
    if (fileViolations.length > 8) {
      lines.push(`  ... ${fileViolations.length - 8} more`);
    }
    if (fileViolations[0].allowlisted && fileViolations[0].reason) {
      lines.push(`  reason: ${fileViolations[0].reason}`);
    }
  }
}

function formatSummary(result) {
  const lines = [];
  lines.push('UI guardrail: raw color literal scan (screens/components)');
  lines.push(`Files scanned: ${result.filesScanned}`);
  lines.push(`Allowlisted files skipped: ${result.skippedAllowlistedFiles.length}`);
  lines.push(`Violations found: ${result.violations.length}`);
  lines.push(`Blocking violations: ${result.blockingViolations.length}`);

  if (result.violations.length > 0) {
    lines.push('');
    formatViolationGroups(lines, result.violations);
  }

  if (result.skippedAllowlistedFiles.length > 0) {
    lines.push('');
    lines.push('Skipped allowlisted files:');
    for (const skipped of result.skippedAllowlistedFiles) {
      lines.push(`  - ${skipped.path}: ${skipped.reason}`);
    }
  }

  return lines.join('\n');
}

function formatLegacyVocabularySummary(result) {
  const lines = [];
  lines.push('UI guardrail: legacy vocabulary scan (app/components/src, .ts + .tsx)');
  lines.push(`Files scanned: ${result.filesScanned}`);
  lines.push(`Blocking violations: ${result.blockingViolations.length}`);

  if (result.blockingViolations.length > 0) {
    lines.push('');
    lines.push(`FAIL the retired styling vocabulary is back — ${LEGACY_VOCABULARY_REMEDY}.`);
    lines.push('');
    formatViolationGroups(lines, result.blockingViolations);
  }

  return lines.join('\n');
}

function formatEdgeShadowSummary(result) {
  const lines = [];
  lines.push(`UI guardrail: shadow outside the edge helper (${result.ownerFile})`);
  lines.push(`Files scanned: ${result.filesScanned}`);
  lines.push(`Blocking violations: ${result.blockingViolations.length}`);

  if (result.blockingViolations.length > 0) {
    lines.push('');
    lines.push(`FAIL a shadow is set outside the edge helper — ${EDGE_SHADOW_REMEDY}.`);
    lines.push('');
    formatViolationGroups(lines, result.blockingViolations);
  }

  return lines.join('\n');
}

function formatBorderSummary(result) {
  const lines = [];
  lines.push(`UI guardrail: container border or radius outside ${result.ownerPrefix}`);
  lines.push(`Files scanned: ${result.filesScanned}`);
  lines.push(`Blocking violations: ${result.blockingViolations.length}`);

  if (result.blockingViolations.length > 0) {
    lines.push('');
    lines.push(`FAIL a container draws its own edge — ${BORDER_REMEDY}.`);
    lines.push('');
    formatViolationGroups(lines, result.blockingViolations);
  }

  return lines.join('\n');
}

function formatRatchetSummary(result, ratchet, { verbose = false } = {}) {
  const lines = [];
  lines.push(`UI guardrail: ${result.definition.title}`);
  lines.push(`Files scanned: ${result.filesScanned}`);
  lines.push(`Blocking violations: ${ratchet.count}`);
  lines.push(`Budget: ${ratchet.budget === null ? '(not configured)' : ratchet.budget}`);

  if (ratchet.direction === 'missing') {
    lines.push('');
    lines.push(
      `FAIL no budget configured for "${result.ruleId}". Add one to scripts/ui-guardrails.config.js.`
    );
  }

  if (ratchet.direction === 'over') {
    lines.push('');
    lines.push(
      `FAIL ${ratchet.count - ratchet.budget} raw value(s) above budget — ${result.definition.remedy}.`
    );
    lines.push('The budget only ever goes down. Do not raise it to make this pass.');
  }

  if (ratchet.direction === 'under') {
    lines.push('');
    lines.push(
      `FAIL ${ratchet.budget - ratchet.count} raw value(s) were removed — lower the budget to ${ratchet.count}.`
    );
    lines.push('Run: npm run lint:ui-guardrails -- --update-budgets');
  }

  if (verbose && result.violations.length > 0) {
    lines.push('');
    formatViolationGroups(lines, result.violations);
  }

  return lines.join('\n');
}

const BUDGET_LINE_INDENT = '    ';

function updateConfigBudgets(counts, configPath) {
  const resolvedPath = configPath || path.join(__dirname, 'ui-guardrails.config.js');
  let source = fs.readFileSync(resolvedPath, 'utf8');

  for (const [ruleId, count] of Object.entries(counts)) {
    const pattern = new RegExp(`(${ruleId}:\\s*\\{[^}]*?budget:\\s*)\\d+`, 's');
    if (!pattern.test(source)) {
      throw new Error(`Could not find a budget for "${ruleId}" in ${resolvedPath}`);
    }
    source = source.replace(pattern, `$1${count}`);
  }

  fs.writeFileSync(resolvedPath, source, 'utf8');
  return resolvedPath;
}

function runUiGuardrailCheck(options = {}) {
  const write = (text) => {
    if (options.stdout) {
      options.stdout.write(`${text}\n`);
    } else {
      process.stdout.write(`${text}\n`);
    }
  };

  const colorResult = findRawColorLiteralViolations(options);
  write(formatSummary(colorResult));

  const legacyResult = findLegacyVocabularyViolations(options);
  write('');
  write(formatLegacyVocabularySummary(legacyResult));

  const edgeShadowResult = findEdgeShadowViolations(options);
  write('');
  write(formatEdgeShadowSummary(edgeShadowResult));

  const borderResult = findBorderViolations(options);
  write('');
  write(formatBorderSummary(borderResult));

  const compactViolations = findCompactPatternViolations(options);
  write('');
  write(`Compact patterns: ${compactViolations.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const violation of compactViolations) write(`  ${violation.file}:${violation.line} — ${violation.rule}`);
  const listViolations = findListPatternViolations(options);
  write(`List patterns: ${listViolations.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const violation of listViolations) write(`  ${violation.file}:${violation.line} — ${violation.rule}`);

  const tableViolations = findTablePatternViolations(options);
  write(`Table patterns: ${tableViolations.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const violation of tableViolations) write(`  ${violation.file}:${violation.line} — ${violation.rule}`);

  const summaryViolations = findSummaryPatternViolations(options);
  write('');
  write(`Summary patterns: ${summaryViolations.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const violation of summaryViolations) write(`  ${violation.file}:${violation.line} — ${violation.rule}`);

  const ratchetResults = [];
  const counts = {};

  for (const definition of RATCHET_RULE_DEFINITIONS) {
    const result = findRatchetRuleViolations({ ...options, ruleId: definition.id });
    const ratchet = evaluateRatchet(result, ratchetRules?.[definition.id]?.budget);
    counts[definition.id] = ratchet.count;
    ratchetResults.push({ result, ratchet });

    write('');
    write(formatRatchetSummary(result, ratchet, { verbose: options.verbose }));
  }

  if (options.updateBudgets) {
    const written = updateConfigBudgets(counts, options.configPath);
    write('');
    write(`Budgets written to ${toPosixPath(path.relative(process.cwd(), written))}:`);
    for (const [ruleId, count] of Object.entries(counts)) {
      write(`${BUDGET_LINE_INDENT}${ruleId}: ${count}`);
    }

    return { color: colorResult, legacy: legacyResult, edgeShadow: edgeShadowResult, border: borderResult, ratchets: ratchetResults, counts, ok: true };
  }

  const ok =
    compactViolations.length === 0 &&
    listViolations.length === 0 &&
    tableViolations.length === 0 &&
    summaryViolations.length === 0 &&
    colorResult.blockingViolations.length === 0 &&
    legacyResult.blockingViolations.length === 0 &&
    edgeShadowResult.blockingViolations.length === 0 &&
    borderResult.blockingViolations.length === 0 &&
    ratchetResults.every((entry) => entry.ratchet.ok);

  return { color: colorResult, legacy: legacyResult, edgeShadow: edgeShadowResult, border: borderResult, ratchets: ratchetResults, counts, ok };
}

function parseArgs(argv) {
  return {
    includeAllowlisted: argv.includes('--include-allowlisted'),
    updateBudgets: argv.includes('--update-budgets'),
    verbose: argv.includes('--verbose'),
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = runUiGuardrailCheck(args);
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  BORDER_KEY_REGEX,
  EDGE_SHADOW_REGEX,
  RAW_COLOR_LITERAL_REGEX,
  RAW_FONT_SIZE_REGEX,
  RAW_SPACING_REGEX,
  RAW_RADIUS_REGEX,
  RATCHET_RULE_DEFINITIONS,
  buildLegacyVocabularyRegex,
  collectUiFiles,
  evaluateRatchet,
  findBorderViolations,
  findEdgeShadowViolations,
  findLegacyVocabularyViolations,
  findRawColorLiteralViolations,
  findRatchetRuleViolations,
  formatBorderSummary,
  formatEdgeShadowSummary,
  formatLegacyVocabularySummary,
  formatRatchetSummary,
  formatSummary,
  runUiGuardrailCheck,
  updateConfigBudgets,
};
