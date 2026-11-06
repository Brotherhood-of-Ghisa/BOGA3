// Node test environment for suites that opt out of the native one with
// `/** @jest-environment ./jest.node-environment.js */`. Use it instead of the
// bare `node` environment: the jest-expo setup still installs Expo's lazy
// globals (`fetch`, `structuredClone`, ...), and from Jest 30.4 teardown reads
// every global, so a lazy getter requires a module after the test has ended
// and fails the suite. jest-expo's native environment skips accessor globals
// during that read; this reuses it with Node's export conditions.
const NativeEnvironment = require('jest-expo/src/preset/nativeEnvironment');

class NodeEnvironment extends NativeEnvironment {
  customExportConditions = ['node', 'node-addons'];
}

module.exports = NodeEnvironment;
module.exports.TestEnvironment = NodeEnvironment;
