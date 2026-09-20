#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { rawColorLiteralRule, ratchetRules } = require('./ui-guardrails.config');

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
    remedy: 'use uiRadius.* from @/components/ui/tokens',
    skipZero: true,
  },
];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function collectUiFiles(rootDir) {
  const targets = ['app', 'components'];
  const results = [];

  for (const target of targets) {
    const absoluteTarget = path.join(rootDir, target);
    if (!fs.existsSync(absoluteTarget)) {
      continue;
    }

    walkDirectory(absoluteTarget, (absoluteFilePath) => {
      const relativePath = toPosixPath(path.relative(rootDir, absoluteFilePath));
      if (!isUiSourceFile(relativePath)) {
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

function isUiSourceFile(relativePath) {
  if (!(relativePath.startsWith('app/') || relativePath.startsWith('components/'))) {
    return false;
  }

  if (!relativePath.endsWith('.tsx')) {
    return false;
  }

  if (relativePath.includes('/__tests__/') || relativePath.includes('/__snapshots__/')) {
    return false;
  }

  if (
    relativePath.endsWith('.test.tsx') ||
    relativePath.endsWith('.spec.tsx') ||
    relativePath.endsWith('.stories.tsx')
  ) {
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
} = {}) {
  const resolvedRootDir = rootDir || path.resolve(__dirname, '..');
  const allowlist = normalizeAllowlistEntries(allowlistedFiles);
  const files = collectUiFiles(resolvedRootDir);

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

    return { color: colorResult, ratchets: ratchetResults, counts, ok: true };
  }

  const ok =
    colorResult.blockingViolations.length === 0 &&
    ratchetResults.every((entry) => entry.ratchet.ok);

  return { color: colorResult, ratchets: ratchetResults, counts, ok };
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
  RAW_COLOR_LITERAL_REGEX,
  RAW_FONT_SIZE_REGEX,
  RAW_SPACING_REGEX,
  RAW_RADIUS_REGEX,
  RATCHET_RULE_DEFINITIONS,
  collectUiFiles,
  evaluateRatchet,
  findRawColorLiteralViolations,
  findRatchetRuleViolations,
  formatRatchetSummary,
  formatSummary,
  runUiGuardrailCheck,
  updateConfigBudgets,
};
