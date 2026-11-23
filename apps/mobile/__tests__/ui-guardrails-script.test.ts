import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as guardrailScript from '../scripts/check-ui-guardrails.js';

type ScanResult = {
  violations: { file: string; literal: string; allowlisted: boolean; reason: string | null }[];
  blockingViolations: { file: string; literal: string; allowlisted: boolean }[];
  skippedAllowlistedFiles: { path: string; reason: string }[];
};

const {
  findBorderViolations,
  findEdgeShadowViolations,
  findLegacyVocabularyViolations,
  findRawColorLiteralViolations,
  findRatchetRuleViolations,
  evaluateRatchet,
  updateConfigBudgets,
} = guardrailScript as {
  findBorderViolations: (options?: { rootDir?: string; ownerPrefix?: string }) => ScanResult & {
    filesScanned: number;
    ownerPrefix: string;
  };
  findEdgeShadowViolations: (options?: { rootDir?: string; ownerFile?: string }) => ScanResult & {
    filesScanned: number;
    ownerFile: string;
  };
  findLegacyVocabularyViolations: (options?: { rootDir?: string }) => ScanResult & {
    filesScanned: number;
  };
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
      'components/__tests__/ignored.test.tsx',
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

describe('UI guardrail legacy vocabulary rule', () => {
  const retired = [
    'uiColors',
    'uiRadius',
    'uiElevation',
    'UiText',
    'UiSurface',
    'UiButton',
    'SegmentedChips',
    'UiColorToken',
    'UiRadiusToken',
    'UiElevationToken',
    'UiTextVariant',
    'UiSurfaceVariant',
    'UiButtonVariant',
  ];

  it.each(['app', 'components', 'src'])('flags every retired name in .ts and .tsx under %s/', (root) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-legacy-'));

    retired.forEach((name, index) => {
      const extension = index % 2 === 0 ? 'ts' : 'tsx';
      writeFile(tempRoot, `${root}/nested/uses-${name}.${extension}`, `export const x = ${name};\n`);
    });
    writeFile(
      tempRoot,
      `${root}/aggregate.tsx`,
      `const a = uiTokens.colors.ink;\nconst b = uiTokens.radius.md;\nconst c = uiTokens.elevation.card;\n`
    );

    const result = findLegacyVocabularyViolations({ rootDir: tempRoot });

    expect(literalsOf(result).sort()).toEqual(
      [...retired, 'uiTokens.colors', 'uiTokens.radius', 'uiTokens.elevation'].sort()
    );
    // Both extensions are scanned, not just one.
    expect(new Set(result.blockingViolations.map((v) => path.extname(v.file)))).toEqual(
      new Set(['.ts', '.tsx'])
    );
  });

  it('ignores tests, snapshots and a retired name inside a longer identifier', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-legacy-'));

    writeFile(tempRoot, 'components/__tests__/screen.test.tsx', `import { uiColors } from '@/components/ui';\n`);
    writeFile(tempRoot, 'src/sync/gate.test.ts', `const t = UiText;\n`);
    writeFile(tempRoot, 'components/card.spec.tsx', `const t = UiSurface;\n`);
    writeFile(tempRoot, 'components/__snapshots__/card.tsx', `const t = UiButton;\n`);
    writeFile(
      tempRoot,
      'components/helpers.ts',
      `export const myUiColorsHelper = 1;\nexport const uiRadiusLike = 2;\nexport type NotUiTextVariantX = 3;\nexport const roles = uiTokens.roles;\n`
    );

    const result = findLegacyVocabularyViolations({ rootDir: tempRoot });

    expect(result.filesScanned).toBe(1);
    expect(literalsOf(result)).toEqual([]);
  });

  it('scans nothing outside app/, components/ and src/', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-legacy-'));

    writeFile(tempRoot, 'scripts/tool.ts', `const t = uiColors;\n`);

    expect(literalsOf(findLegacyVocabularyViolations({ rootDir: tempRoot }))).toEqual([]);
  });
});

describe('UI guardrail edge shadow rule', () => {
  const OWNER = 'components/ui/edge.ts';

  it.each(['app', 'components', 'src'])('flags any shadow, boxShadow or elevation under %s/ outside the edge helper', (root) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-edge-'));

    writeFile(
      tempRoot,
      `${root}/card.tsx`,
      `const styles = { card: { shadowColor: roles.ink, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 } };
`
    );
    writeFile(tempRoot, `${root}/lifted.ts`, `export const lifted = { boxShadow: [{ offsetY: 1, blurRadius: 2 }], elevation: 2 };
`);
    writeFile(tempRoot, `${root}/prop.tsx`, `<View elevation={2} />;
`);

    const result = findEdgeShadowViolations({ rootDir: tempRoot, ownerFile: OWNER });

    expect(literalsOf(result).map((literal) => literal.replace(/\s*[:=]$/, '')).sort()).toEqual(
      ['boxShadow', 'elevation', 'elevation', 'shadowColor', 'shadowOffset', 'shadowOpacity', 'shadowRadius'].sort()
    );
  });

  it('lets the edge helper set its shadows, and ignores tests, comments without a key and longer names', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-edge-'));

    writeFile(tempRoot, OWNER, `export const uiEdge = () => ({ boxShadow: [] });
`);
    writeFile(tempRoot, 'components/__tests__/card.test.tsx', `expect(style.boxShadow).toBeUndefined(); const s = { elevation: 1 };
`);
    writeFile(
      tempRoot,
      'src/health/mapping.ts',
      `// Depth is a ground change, never an elevation.
export const row = { elevation_gain_m: 3, elevationAscended: 2, textShadowColor: 'x' };
if (style.elevation === 2 || boxShadow == null) {}
`
    );

    expect(literalsOf(findEdgeShadowViolations({ rootDir: tempRoot, ownerFile: OWNER }))).toEqual([]);
  });

  it('names the edge helper in the shipped config, so nothing else may own a shadow', () => {
    expect(findEdgeShadowViolations().ownerFile).toBe(OWNER);
    expect(literalsOf(findEdgeShadowViolations())).toEqual([]);
  });
});

describe('UI guardrail border rule', () => {
  const OWNER = 'components/ui/';

  function scan(files: Record<string, string>) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-guardrail-border-'));
    for (const [relativePath, content] of Object.entries(files)) writeFile(tempRoot, relativePath, content);
    return literalsOf(findBorderViolations({ rootDir: tempRoot, ownerPrefix: OWNER }));
  }

  it.each(['app', 'components', 'src'])('flags a container border, colour, radius or dash under %s/', (root) => {
    const literals = scan({
      [`${root}/box.tsx`]: `const styles = { box: { borderWidth: 1, borderColor: roles.rule, borderRadius: 4, borderStyle: 'dashed' } };
`,
      [`${root}/corners.ts`]: `export const corners = { borderTopLeftRadius: uiGeometry.radius.card, borderBottomEndRadius: 2 };
`,
    });

    expect(literals.sort()).toEqual(
      [
        'borderWidth: 1',
        'borderColor: roles.rule',
        'borderRadius: 4',
        "borderStyle: 'dashed'",
        'borderTopLeftRadius: uiGeometry.radius.card',
        'borderBottomEndRadius: 2',
      ].sort()
    );
  });

  it('flags an inline override and a box edge drawn per side or per axis', () => {
    expect(
      scan({
        'components/row.tsx': `<View style={[styles.row, { borderColor: roles.danger }]} />;
const styles = { frame: { borderHorizontalWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopColor: roles.rule } };
`,
      })
    ).toEqual(['borderColor: roles.danger', 'borderHorizontalWidth: 1', 'borderLeftWidth: 1', 'borderRightWidth: 1', 'borderTopColor: roles.rule']);
  });

  it('passes a single-side ruleSoft row divider, on any side and in a one-line or multi-line style', () => {
    expect(
      scan({
        'components/rows.tsx': `const styles = {
  top: { borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft },
  bottom: {
    paddingTop: uiSpace.sm,
    borderBottomWidth: 1,
    borderBottomColor: liveRoles.ruleSoft,
  },
  guide: { borderLeftWidth: uiBorder.width, borderLeftColor: roles.ruleSoft },
  end: { borderEndWidth: 1, borderEndColor: roles.ruleSoft },
};
`,
      })
    ).toEqual([]);
  });

  it('flags a single-side divider that is not ruleSoft, or whose colour is another side or another object', () => {
    expect(
      scan({
        'components/rows.tsx': `const styles = {
  loud: { borderTopWidth: 1, borderTopColor: roles.rule },
  accent: { borderLeftWidth: 4, borderLeftColor: roles.accent },
  bare: { borderBottomWidth: 1 },
  wrongSide: { borderTopWidth: 1, borderBottomColor: roles.ruleSoft },
  split: { borderTopWidth: 1 },
  elsewhere: { borderTopColor: roles.ruleSoft, nested: { borderTopWidth: 1 } },
};
`,
      })
    ).toEqual([
      'borderTopWidth: 1',
      'borderTopColor: roles.rule',
      'borderLeftWidth: 4',
      'borderLeftColor: roles.accent',
      'borderBottomWidth: 1',
      'borderTopWidth: 1',
      'borderTopWidth: 1',
      'borderTopWidth: 1',
    ]);
  });

  it('treats a zero width or radius as the absence of an edge', () => {
    expect(
      scan({
        'components/reset.tsx': `const styles = { flush: { borderTopWidth: 0, borderRadius: 0, borderWidth: 0 } };
`,
      })
    ).toEqual([]);
  });

  it('exempts only components/ui, and ignores tests and longer names', () => {
    expect(
      scan({
        'components/ui/card.tsx': `export const card = { borderWidth: 1, borderColor: roles.rule, borderRadius: 4 };
`,
        'components/__tests__/card.test.tsx': `expect(style).toMatchObject({ borderRadius: 4 });
`,
        'components/ui-extras/box.tsx': `const s = { borderColorScheme: 'x', myborderRadius: 4, borderRadiusScale: 2 };
`,
      })
    ).toEqual([]);
  });

  it('holds the shipped repo at zero, with components/ui as the one owner', () => {
    const result = findBorderViolations();

    expect(result.ownerPrefix).toBe(OWNER);
    expect(literalsOf(result)).toEqual([]);
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
      'components/__tests__/ignored.test.tsx',
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
      `const styles = {\n  card: { borderRadius: 12 },\n  pill: { borderRadius: 999 },\n  flat: { borderRadius: 0 },\n  token: { borderRadius: uiGeometry.radius.card },\n};\nexport default styles;\n`
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
