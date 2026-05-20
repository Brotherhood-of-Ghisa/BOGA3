import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as guardrailScript from '../../scripts/check-ui-guardrails.js';

const { findRawColorLiteralViolations } = guardrailScript as {
  findRawColorLiteralViolations: (options?: {
    rootDir?: string;
    includeAllowlisted?: boolean;
    allowlistedFiles?: { path: string; reason: string }[];
  }) => {
    violations: { file: string; literal: string; allowlisted: boolean; reason: string | null }[];
    blockingViolations: { file: string; literal: string; allowlisted: boolean }[];
    skippedAllowlistedFiles: { path: string; reason: string }[];
  };
};

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
