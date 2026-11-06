// Internal provision helper: native Settings is the authority, never a readiness stamp.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const settingsPath = 'Settings → General → AutoFill & Passwords → AutoFill Passwords and Passkeys';

function switchIsOn(hierarchy) {
  const controls = [];
  function visit(node) {
    if (node.attributes?.['resource-id'] === 'AutoFillToggle') controls.push(node.attributes);
    for (const child of node.children ?? []) visit(child);
  }
  visit(JSON.parse(hierarchy));
  const control = controls[0];
  if (controls.length === 1 && control.enabled === 'true') {
    if (control.value === '1' && control.checked === 'true') return true;
    if (control.value === '0' && control.checked === 'false') return false;
  }
  throw new Error('AutoFillToggle is missing, ambiguous, disabled, or has an unreadable state');
}

function prepareAutofill(udid, artifactRoot) {
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(udid ?? '') || !artifactRoot) {
    throw new Error('AutoFill preparation requires an explicit simulator UDID and artifact directory');
  }
  fs.mkdirSync(artifactRoot, { recursive: true });
  const logFile = path.join(artifactRoot, 'setup.log');
  const deadline = Date.now() + 180000;
  const log = (message) => fs.appendFileSync(logFile, `${message}\n`);
  function command(executable, args, diagnostic = false) {
    const timeout = diagnostic ? 15000 : Math.min(60000, deadline - Date.now());
    if (timeout <= 0) throw new Error('AutoFill setup deadline exceeded');
    log([executable, ...args].join(' '));
    const result = childProcess.spawnSync(executable, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
    log(result.stderr ?? '');
    if (result.error || result.status !== 0) {
      log(result.stdout ?? '');
      throw new Error(`${executable} failed: ${result.error?.message ?? `exit ${result.status}`}`);
    }
    return result.stdout;
  }
  function readHierarchy(name, diagnostic = false) {
    const hierarchy = command('maestro', ['--udid', udid, 'hierarchy', '--no-reinstall-driver'], diagnostic);
    fs.writeFileSync(path.join(artifactRoot, `${name}.json`), hierarchy);
    return hierarchy;
  }
  function runFlow(name, body, reuseDriver = false) {
    const flow = path.join(artifactRoot, `${name}.yaml`);
    fs.writeFileSync(flow, `# Proves: native AutoFill setup before sign-in.\n# Why device: Settings is outside the app.\n# Jest counterpart: maestro-ios-autofill.test.ts\nappId: com.apple.Preferences\n---\n${body}`);
    command('maestro', ['--udid', udid, 'test', flow,
      '--debug-output', path.join(artifactRoot, name), ...(reuseDriver ? ['--no-reinstall-driver'] : [])]);
  }

  log(`Target: ${udid}\n${settingsPath}`);
  console.log(`[maestro-autofill] Checking ${udid}; artifacts: ${artifactRoot}`);
  try {
    runFlow('navigate', `- launchApp
- runFlow:
    when:
      notVisible:
        id: AutoFillToggle
    commands:
      - scrollUntilVisible:
          element:
            id: com.apple.settings.general
          direction: UP
          centerElement: true
      - tapOn:
          id: com.apple.settings.general
      - scrollUntilVisible:
          element:
            text: AutoFill & Passwords
          direction: DOWN
          centerElement: true
      - tapOn: AutoFill & Passwords
- assertVisible:
    id: AutoFillToggle
`);
    if (switchIsOn(readHierarchy('before'))) {
      log('AutoFill is on; turning it off through Settings');
      runFlow('disable', `- tapOn:
    childOf:
      id: AutoFillToggle
    checked: true
- assertVisible:
    id: AutoFillToggle
    checked: false
`, true);
    } else {
      log('AutoFill is already off; no toggle');
    }
    if (switchIsOn(readHierarchy('after'))) throw new Error('AutoFill stayed on after preparation');
    command('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(artifactRoot, 'verified-off.png')]);
    console.log(`[maestro-autofill] Verified AutoFill off on ${udid}`);
    log('Verified off');
  } catch (error) {
    log(error.message);
    for (const capture of [
      () => command('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(artifactRoot, 'failure.png')], true),
      () => readHierarchy('failure-hierarchy', true),
    ]) {
      try { capture(); } catch (diagnosticError) { log(`Diagnostic capture failed: ${diagnosticError.message}`); }
    }
    throw new Error(`AutoFill setup failed on ${udid}: ${error.message}. Turn the switch off at ${settingsPath}, then rerun the lane. Artifacts: ${artifactRoot}`);
  }
}

module.exports = { prepareAutofill, switchIsOn };
