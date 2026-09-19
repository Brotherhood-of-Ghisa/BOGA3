import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as guardrailScript from '../../scripts/check-ui-guardrails.js';

type ScanResult = {
  violations: { file: string; literal: string; allowlisted: boolean; reason: string | null }[];
  blockingViolations: { file: string; literal: string; allowlisted: boolean }[];
  skippedAllowlistedFiles: { path: string; reason: string }[];
};

const {
  findRawColorLiteralViolations,
  findRatchetRuleViolations,
  evaluateRatchet,
  updateConfigBudgets,
} = guardrailScript as {
  findRawColorLiteralViolations: (options?: {
    rootDir?: string;
    includeAllowlisted?: boolean;
    allowlistedFiles?: { path: string; reason: string }[];
  }) => ScanResult;
  findRatchetRuleViolations: (options: {
    ruleId: string;
    rootDir?: string;
    includeAllowlisted?: boolean;
    allowlistedFiles?: { path: string; reason: string }[];
  }) => ScanResult & { ruleId: string };
  evaluateRatchet: (
    result: { blockingViolations: unknown[] },
    budget: number | undefined
  ) => { ok: boolean; count: number; budget: number | null; direction: string };
  updateConfigBudgets: (counts: Record<string, number>, configPath: string) => string;
};

function literalsOf(result: ScanResult) {
  return result.blockingViolations.map((violation) => violation.literal);
}

function writeFile(rootDir: string, relativePath: string, content: string) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
}

describe('UI guardrail script', () => {
  it('flags raw color literals in UI tsx files and ignores test files', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-'));

    writeFile(
      tempRoot,
      'app/example-screen.tsx',
      `const styles = { container: { backgroundColor: '#ff0000' } };\nexport default styles;\n`
    );
    writeFile(
      tempRoot,
      'app/__tests__/ignored.test.tsx',
      `const styles = { container: { backgroundColor: '#00ff00' } };\nexport default styles;\n`
    );
    writeFile(
      tempRoot,
      'components/example-card.tsx',
      `const styles = { text: { color: 'rgba(1, 2, 3, 0.5)' } };\nexport default styles;\n`
    );

    const result = findRawColorLiteralViolations({ rootDir: tempRoot });

    expect(result.blockingViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'app/example-screen.tsx',
          literal: '#ff0000',
          allowlisted: false,
        }),
        expect.objectContaining({
          file: 'components/example-card.tsx',
          literal: 'rgba(1, 2, 3, 0.5)',
          allowlisted: false,
        }),
      ])
    );
    expect(result.blockingViolations.some((violation: { file: string }) => violation.file.includes('__tests__'))).toBe(false);
  });

  it('skips allowlisted files by default and marks them non-blocking in audit mode', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-'));
    writeFile(
      tempRoot,
      'app/legacy-screen.tsx',
      `const styles = { container: { backgroundColor: '#abcdef' } };\nexport default styles;\n`
    );

    const allowlistedFiles = [
      { path: 'app/legacy-screen.tsx', reason: 'Legacy migration pending.' },
    ];

    const defaultRun = findRawColorLiteralViolations({ rootDir: tempRoot, allowlistedFiles });
    expect(defaultRun.blockingViolations).toHaveLength(0);
    expect(defaultRun.violations).toHaveLength(0);
    expect(defaultRun.skippedAllowlistedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'app/legacy-screen.tsx', reason: 'Legacy migration pending.' }),
      ])
    );

    const auditRun = findRawColorLiteralViolations({
      rootDir: tempRoot,
      allowlistedFiles,
      includeAllowlisted: true,
    });
    expect(auditRun.blockingViolations).toHaveLength(0);
    expect(auditRun.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'app/legacy-screen.tsx',
          literal: '#abcdef',
          allowlisted: true,
          reason: 'Legacy migration pending.',
        }),
      ])
    );
  });
});

describe('UI guardrail ratchet rules', () => {
  it('flags raw fontSize literals and ignores test files', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-type-'));

    writeFile(
      tempRoot,
      'app/example-screen.tsx',
      `const styles = { title: { fontSize: 24 }, body: { fontSize: 14 } };\nexport default styles;\n`
    );
    writeFile(
      tempRoot,
      'app/__tests__/ignored.test.tsx',
      `const styles = { title: { fontSize: 99 } };\nexport default styles;\n`
    );
    writeFile(
      tempRoot,
      'components/tokenised.tsx',
      `const styles = { title: { fontSize: uiTypography.size.lg } };\nexport default styles;\n`
    );

    const result = findRatchetRuleViolations({ ruleId: 'rawFontSize', rootDir: tempRoot });

    expect(literalsOf(result).sort()).toEqual(['fontSize: 14', 'fontSize: 24']);
  });

  it('flags raw spacing literals but treats 0 as the absence of a value', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-space-'));

    writeFile(
      tempRoot,
      'app/example-screen.tsx',
      `const styles = {\n  row: { paddingHorizontal: 12, gap: 8, marginTop: 0, padding: 0 },\n  col: { rowGap: 4, paddingVertical: uiSpace.sm },\n};\nexport default styles;\n`
    );

    const result = findRatchetRuleViolations({ ruleId: 'rawSpacing', rootDir: tempRoot });

    expect(literalsOf(result).sort()).toEqual(['gap: 8', 'paddingHorizontal: 12', 'rowGap: 4']);
  });

  it('flags raw border radii but treats 0 as the absence of a value', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-radius-'));

    writeFile(
      tempRoot,
      'components/card.tsx',
      `const styles = {\n  card: { borderRadius: 12 },\n  pill: { borderRadius: 999 },\n  flat: { borderRadius: 0 },\n  token: { borderRadius: uiRadius.md },\n};\nexport default styles;\n`
    );

    const result = findRatchetRuleViolations({ ruleId: 'rawRadius', rootDir: tempRoot });

    expect(literalsOf(result).sort()).toEqual(['borderRadius: 12', 'borderRadius: 999']);
  });

  it('throws on an unknown rule id rather than silently passing', () => {
    expect(() => findRatchetRuleViolations({ ruleId: 'rawNonsense' })).toThrow(/Unknown ratchet rule/);
  });

  it('only passes when the count equals the budget, so the budget can only fall', () => {
    const three = { blockingViolations: [1, 2, 3] };

    expect(evaluateRatchet(three, 3)).toEqual({ ok: true, count: 3, budget: 3, direction: 'equal' });
    expect(evaluateRatchet(three, 2)).toEqual({ ok: false, count: 3, budget: 2, direction: 'over' });
    expect(evaluateRatchet(three, 4)).toEqual({ ok: false, count: 3, budget: 4, direction: 'under' });
    expect(evaluateRatchet(three, undefined)).toEqual({
      ok: false,
      count: 3,
      budget: null,
      direction: 'missing',
    });
  });

  it('rewrites budgets in place without disturbing the rest of the config', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-config-'));
    const configPath = path.join(tempRoot, 'ui-guardrails.config.js');
    fs.writeFileSync(
      configPath,
      [
        'module.exports = {',
        '  rawColorLiteralRule: { allowlistedFiles: [] },',
        '  ratchetRules: {',
        '    rawFontSize: {',
        '      budget: 196,',
        '      allowlistedFiles: [],',
        '    },',
        '    rawSpacing: {',
        '      budget: 416,',
        '      allowlistedFiles: [],',
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8'
    );

    updateConfigBudgets({ rawFontSize: 180, rawSpacing: 400 }, configPath);

    const updated = fs.readFileSync(configPath, 'utf8');
    expect(updated).toContain('budget: 180');
    expect(updated).toContain('budget: 400');
    expect(updated).toContain('rawColorLiteralRule: { allowlistedFiles: [] }');
    expect(updated).not.toContain('budget: 196');
  });

  it('refuses to write a budget the config does not declare', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-config-'));
    const configPath = path.join(tempRoot, 'ui-guardrails.config.js');
    fs.writeFileSync(configPath, 'module.exports = { ratchetRules: {} };\n', 'utf8');

    expect(() => updateConfigBudgets({ rawFontSize: 1 }, configPath)).toThrow(/Could not find a budget/);
  });
});
