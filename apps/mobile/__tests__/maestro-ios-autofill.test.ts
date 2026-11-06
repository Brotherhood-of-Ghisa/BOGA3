import * as childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

const { prepareAutofill, switchIsOn } = require('../scripts/maestro-ios-autofill');
const udid = '11111111-2222-3333-4444-555555555555';
const replacement = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Native iOS 27 hierarchy shape: the label child also has checked=false, so
// matching by text alone would incorrectly call an unreadable/on switch off.
function hierarchy(on: boolean, attributes = {}) {
  return JSON.stringify({ children: [{ attributes: {
    'resource-id': 'AutoFillToggle', enabled: 'true', value: on ? '1' : '0',
    checked: String(on), ...attributes,
  }, children: [{ attributes: { accessibilityText: 'AutoFill Passwords and Passkeys', checked: 'false' } }] }] });
}

let root: string;
let on: boolean;
let toggleWorks: boolean;
let unreadable: boolean;
let failCommand: string;
let calls: { executable: string; args: string[]; timeout: number; killSignal: string }[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'boga-autofill-'));
  on = true;
  toggleWorks = true;
  unreadable = false;
  failCommand = '';
  calls = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const spawn = childProcess.spawnSync as jest.Mock;
  spawn.mockReset();
  spawn.mockImplementation((executable: string, args: string[], options: { timeout: number; killSignal: string }) => {
    calls.push({ executable, args, timeout: options.timeout, killSignal: options.killSignal });
    const command = args.join(' ');
    if (failCommand && command.includes(failCommand)) {
      return { status: null, stdout: '', stderr: 'native command failed', error: new Error('ETIMEDOUT') };
    }
    if (command.includes('disable.yaml') && toggleWorks) on = false;
    return { status: 0, stderr: '', stdout: args.includes('hierarchy')
      ? (unreadable ? hierarchy(false, { value: '' }) : hierarchy(on)) : '' };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

it('prepares an on simulator and verifies a fresh hierarchy after toggling', () => {
  prepareAutofill(udid, root);
  expect(calls.map(({ args }) => args.includes('hierarchy') ? 'read'
    : args.some((arg) => arg.endsWith('.yaml')) ? args[3].split('/').pop() : 'screenshot'))
    .toEqual(['navigate.yaml', 'read', 'disable.yaml', 'read', 'screenshot']);
  expect(switchIsOn(readFileSync(join(root, 'before.json'), 'utf8'))).toBe(true);
  expect(switchIsOn(readFileSync(join(root, 'after.json'), 'utf8'))).toBe(false);
  expect(readFileSync(join(root, 'disable.yaml'), 'utf8')).toContain('checked: true');
  for (const call of calls) {
    expect(call.args).toContain(udid);
    expect(call.timeout).toBeGreaterThan(0);
    expect(call.timeout).toBeLessThanOrEqual(60000);
    expect(call.killSignal).toBe('SIGKILL');
  }
});

it('does not toggle an off simulator, but reads its actual state again on the next run', () => {
  on = false;
  prepareAutofill(udid, root);
  expect(calls.some(({ args }) => args.join(' ').includes('disable.yaml'))).toBe(false);
  expect(calls.filter(({ args }) => args.includes('hierarchy'))).toHaveLength(2);
  on = true;
  calls = [];
  prepareAutofill(udid, root);
  expect(calls.some(({ args }) => args.join(' ').includes('disable.yaml'))).toBe(true);
});

it('rechecks a recreated simulator by UDID even with predecessor artifacts present', () => {
  on = false;
  prepareAutofill(udid, root);
  calls = [];
  on = true;
  prepareAutofill(replacement, root);
  expect(on).toBe(false);
  for (const call of calls) {
    expect(call.args).toContain(replacement);
    expect(call.args).not.toContain(udid);
  }
});

it.each([
  ['missing', '{}'],
  ['label without switch', hierarchy(false, { 'resource-id': '' })],
  ['missing value', hierarchy(false, { value: '' })],
  ['inconsistent state', hierarchy(false, { checked: 'true' })],
  ['disabled', hierarchy(false, { enabled: 'false' })],
  ['duplicate', JSON.stringify({ children: [JSON.parse(hierarchy(false)), JSON.parse(hierarchy(false))] })],
  ['invalid JSON', 'not JSON'],
])('rejects %s hierarchy instead of assuming off', (_name, json) => {
  expect(() => switchIsOn(json)).toThrow();
});

it('stops on unreadable state and saves diagnostics with actionable recovery', () => {
  unreadable = true;
  expect(() => prepareAutofill(udid, root)).toThrow(
    `Turn the switch off at Settings → General → AutoFill & Passwords → AutoFill Passwords and Passkeys`);
  expect(readFileSync(join(root, 'setup.log'), 'utf8')).toContain(udid);
  expect(readFileSync(join(root, 'failure-hierarchy.json'), 'utf8')).toContain('AutoFillToggle');
  expect(calls.some(({ args }) => args.includes(join(root, 'failure.png')))).toBe(true);
  expect(calls.some(({ args }) => args.join(' ').includes('disable.yaml'))).toBe(false);
});

it('does not accept a successful toggle command without an off readback', () => {
  toggleWorks = false;
  expect(() => prepareAutofill(udid, root)).toThrow('AutoFill stayed on');
  expect(readFileSync(join(root, 'setup.log'), 'utf8')).not.toContain('Verified off');
});

it('bounds native commands and preserves the original setup error if diagnostics also fail', () => {
  failCommand = udid;
  expect(() => prepareAutofill(udid, root)).toThrow(`AutoFill setup failed on ${udid}: maestro failed: ETIMEDOUT`);
  expect(calls).toHaveLength(3);
  expect(calls.map(({ timeout }) => timeout)).toEqual([60000, 15000, 15000]);
  expect(calls.every(({ killSignal }) => killSignal === 'SIGKILL')).toBe(true);
  expect(readFileSync(join(root, 'setup.log'), 'utf8')).toContain('Diagnostic capture failed');
});

it('never falls back to an implicitly booted or missing target', () => {
  expect(() => prepareAutofill('booted', root)).toThrow('explicit simulator UDID');
  expect(() => prepareAutofill(undefined, root)).toThrow('explicit simulator UDID');
  expect(calls).toHaveLength(0);
});

it('stops at the overall setup deadline and still attempts bounded diagnostics', () => {
  jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(180001);
  expect(() => prepareAutofill(udid, root)).toThrow('AutoFill setup deadline exceeded');
  expect(calls).toHaveLength(2);
  expect(calls.every(({ timeout, killSignal }) => timeout === 15000 && killSignal === 'SIGKILL')).toBe(true);
});
