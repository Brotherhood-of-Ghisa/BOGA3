/** @jest-environment ./jest.node-environment.js */
// Jest 30.4+ teardown reads every enumerable global (clearMocksOnScope). A lazy
// global like Expo's `fetch` must not be resolved then: its getter requires a
// module after the test has finished, which fails the whole suite.
test('teardown leaves lazy accessor globals unread', () => {
  Object.defineProperty(globalThis, '__lazyTeardownProbe', {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error('lazy global read during teardown');
    },
  });
  expect(Object.keys(globalThis)).toContain('__lazyTeardownProbe');
});
