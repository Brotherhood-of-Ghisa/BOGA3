import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');

function requiredLanes(platform: string, path: string) {
  return execFileSync('bash', [join(repoRoot, 'scripts/test-for.sh'), '--tsv', '--platform', platform, path], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim().split('\n').map((line) => line.split('\t')[0]);
}

describe('platform-specific group UI checks', () => {
  it.each([
    'apps/mobile/app/group/join.tsx',
    'apps/mobile/app/group-session/[sessionId].tsx',
    'apps/mobile/app/(tabs)/groups.tsx',
    'apps/mobile/app/exercise-link.tsx',
    'apps/mobile/components/groups/stream-row.tsx',
  ])('keeps device checks for %s on each platform', (path) => {
    expect(requiredLanes('android', path)).toEqual(['fast', 'android-smoke']);
    expect(requiredLanes('ios', path)).toEqual(['fast', 'ios-groups-e2e', 'ios-smoke']);
    expect(requiredLanes('all', path)).toEqual(['fast', 'android-smoke', 'ios-groups-e2e', 'ios-smoke']);
  });

  it.each([
    'apps/mobile/.maestro/flows/groups-two-user-stream.yaml',
    'apps/mobile/.maestro/flows/session-completion-states-fixture.yaml',
  ])('does not add Android checks for the iOS-only flow %s', (path) => {
    expect(requiredLanes('android', path)).toEqual(['meta-tests']);
  });
});

describe('host doctor', () => {
  let fixture: string;

  function stub(path: string, body: string) {
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  }

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'boga-doctor-'));
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'bin'));
    mkdirSync(join(fixture, 'sdk'));
    copyFileSync(join(repoRoot, 'boga'), join(fixture, 'boga'));
    for (const script of ['worktree-lib.sh', 'lane-timing.sh']) {
      copyFileSync(join(repoRoot, 'scripts', script), join(fixture, 'scripts', script));
    }
    // Keep JDK auto-discovery from replacing the deliberate incompatible runtime.
    writeFileSync(join(fixture, 'scripts/java-env.sh'), '');
    stub(join(fixture, 'scripts/worktree-doctor.sh'), 'exit "${STUB_WORKTREE_EXIT:-0}"');
    stub(join(fixture, 'bin/uname'), 'echo "${STUB_HOST:-Linux}"');
    stub(join(fixture, 'bin/java'), 'printf \'openjdk version "%s.0.1"\\n\' "${STUB_JAVA_VERSION:-21}" >&2');
    stub(join(fixture, 'bin/emulator'), '[[ "$1" != "-list-avds" ]] || printf "%s\\n" "${STUB_AVDS:-}"');
    stub(join(fixture, 'bin/adb'), '[[ "$1" != "devices" ]] || printf "List of devices attached\\n%s\\n" "${STUB_DEVICES:-}"');
    stub(join(fixture, 'bin/xcodebuild'), 'echo "Xcode 27.0"');
    for (const command of ['docker', 'gh', 'maestro', 'node', 'jq', 'xcrun']) {
      stub(join(fixture, 'bin', command), `exit "\${STUB_${command.toUpperCase()}_EXIT:-0}"`);
    }
  });

  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  function doctor(overrides: Record<string, string | undefined> = {}) {
    return spawnSync('bash', [join(fixture, 'boga'), 'doctor'], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${join(fixture, 'bin')}:${process.env.PATH}`,
        ANDROID_HOME: join(fixture, 'sdk'),
        JAVA_HOME: fixture,
        STUB_AVDS: '',
        STUB_DEVICES: '',
        ...overrides,
      },
    });
  }

  it('fails on Linux without an AVD or connected device', () => {
    const result = doctor();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL Android device target');
    expect(result.stdout).toContain('OK   java runtime for Gradle');
    expect(result.stdout).toContain('OK   maestro CLI');
  });

  it.each([
    { STUB_AVDS: 'Pixel_10' },
    { STUB_DEVICES: 'emulator-5554\tdevice' },
  ])('passes on Linux with a usable target: %j', (target) => {
    expect(doctor(target).status).toBe(0);
  });

  it('fails on Linux with an incompatible JDK despite a usable target', () => {
    const result = doctor({ STUB_AVDS: 'Pixel_10', STUB_JAVA_VERSION: '25' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL java runtime for Gradle');
  });

  it.each(['STUB_DOCKER_EXIT', 'STUB_MAESTRO_EXIT', 'STUB_WORKTREE_EXIT'])('preserves failure of %s', (check) => {
    expect(doctor({ STUB_AVDS: 'Pixel_10', [check]: '1' }).status).toBe(1);
  });

  it('uses iOS checks on macOS without requiring an Android target', () => {
    const result = doctor({ STUB_HOST: 'Darwin' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK   iOS simulators');
    expect(result.stdout).not.toContain('Android capability checks');
  });
});
