import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('releases remote main from isolated temporary checkouts and keeps durable artifacts', () => {
  const output = execFileSync('bash', [resolve(__dirname, '../../../scripts/tests/ios-release.test.sh')], {
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(output).toContain('fresh checkouts and cleanup');
  expect(output).toContain('registered lease without a marker is released');
}, 65000);
