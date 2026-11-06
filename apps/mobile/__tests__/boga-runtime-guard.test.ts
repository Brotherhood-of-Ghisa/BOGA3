import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('protects a whole database lane, including direct resets and cleanup, while other runtimes proceed', () => {
  const result = spawnSync('bash', [resolve(__dirname, '../../../scripts/tests/runtime-guard.test.sh')], {
    encoding: 'utf8',
    timeout: 30000,
  });
  expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({
    status: 0,
    output: expect.stringContaining('[runtime-guard-test] passed:'),
  });
}, 35000);
