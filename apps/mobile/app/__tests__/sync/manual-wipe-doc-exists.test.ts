/**
 * Outcome: the one-time local-database wipe is a documented human runbook, NOT
 * an in-app auto-wipe / version-marker code path.
 *
 * The upgrade contract assumes a clean local SQLite on first launch of the new
 * sync build; rather than ship first-boot detection + auto-wipe code (which
 * would re-open the storage / migration design questions the plan deliberately
 * closed), the wipe is a manual procedure every dev / tester / user performs
 * once. This file asserts both halves of that contract:
 *
 *   1. The runbook exists and covers each platform a wipe is needed on — iOS
 *      Simulator, Android Emulator, physical device, and TestFlight.
 *   2. No version-marker / boot-marker module was silently re-introduced under
 *      the data layer. A file named like `v2-boot-marker.ts` (or any
 *      `*boot-marker*` / `*version-marker*` module) would mean the manual
 *      procedure had been quietly turned into code — exactly what the plan
 *      forbids.
 *
 * The wipe procedure itself is a human step; CI verifies its existence and the
 * absence of code, not an actual uninstall/reinstall flow.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const WIPE_DOC_PATH = join(REPO_ROOT, 'docs', 'manual-wipe-v1-to-v2.md');
const DATA_DIR = join(MOBILE_ROOT, 'src', 'data');

describe('the manual wipe runbook exists and covers every platform', () => {
  it('the runbook file is present', () => {
    expect(existsSync(WIPE_DOC_PATH)).toBe(true);
  });

  // Each platform a user might be wiping on must be documented.
  const requiredHeadings = ['iOS Simulator', 'Android Emulator', 'Physical device', 'TestFlight'];

  it.each(requiredHeadings)('documents the %s wipe procedure', (heading) => {
    const doc = readFileSync(WIPE_DOC_PATH, 'utf8');
    // Match the heading as a Markdown section heading (`## ...`) so a passing
    // mention buried in prose does not satisfy the check.
    const headingPattern = new RegExp(`^#{1,3}\\s.*${heading}`, 'im');
    expect(headingPattern.test(doc)).toBe(true);
  });
});

describe('no in-app wipe / version marker module was re-introduced', () => {
  // Recursively collect every module name under the data layer.
  const collectModuleNames = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...collectModuleNames(full));
      } else {
        out.push(entry);
      }
    }
    return out;
  };

  it('has no boot-marker / version-marker module under src/data', () => {
    const names = collectModuleNames(DATA_DIR);
    // Any of these naming shapes would indicate the manual procedure was turned
    // into an auto-wipe / first-boot-detection code path.
    const markerLike = names.filter((name) =>
      /(boot|version)[-_]?marker/i.test(name) || /^v2[-_]boot[-_]marker/i.test(name),
    );
    expect(markerLike).toEqual([]);
  });
});
