import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { SUPPRESS_NOTIFICATION_PROMPT_KEY } from '@/src/session-recorder/notification-prompt-suppression';

const run = promisify(execFile);
const runtime = resolve(__dirname, '../scripts/maestro-ios-runtime.sh');

// The launch seeds the key the app reads; a rename on one side alone would
// bring the notification dialog back on every cold simulator.
it('seeds the exact key the app reads into the dev client preferences', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-seed-'));
  try {
    const calls = join(dir, 'calls');
    writeFileSync(join(dir, 'xcrun'), [
      '#!/usr/bin/env bash',
      `echo "$*" >> "${calls}"`,
      'if [[ "$2" == get_app_container ]]; then echo /data/app; fi',
    ].join('\n'));
    chmodSync(join(dir, 'xcrun'), 0o755);

    await run('bash', ['-c', 'source "$1"; maestro_seed_notification_prompt_suppression SIM com.example.app',
      'seed-test', runtime], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, timeout: 10_000 });

    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      'simctl get_app_container SIM com.example.app data',
      `simctl spawn SIM defaults write /data/app/Library/Preferences/com.example.app.plist ${SUPPRESS_NOTIFICATION_PROMPT_KEY} -bool true`,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
