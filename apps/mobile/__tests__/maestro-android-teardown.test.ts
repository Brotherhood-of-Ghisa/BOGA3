import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const runtime = resolve(__dirname, '../scripts/maestro-android-runtime.sh');

it('terminates the owned emulator process without a serial before waiting for its exit', async () => {
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  const exited = once(child, 'exit');
  try {
    await run('bash', ['-c', 'source "$1"; maestro_android_teardown_emulator "$2" "" 0',
      'teardown-test', runtime, String(child.pid)], { timeout: 5000 });
    const [code, signal] = await exited;
    expect(code).toBeNull();
    expect(signal).toBe('SIGTERM');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
});
