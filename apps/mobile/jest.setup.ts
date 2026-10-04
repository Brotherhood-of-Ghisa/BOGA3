import { cleanup, configure } from '@testing-library/react-native';
import {
  __resetAccountLocalPreferencesForTests,
} from '@/src/preferences/account-local';

// Under multi-core parallel Jest runs across 200+ suites, 1s async timeout
// causes flaky timeouts under CPU scheduling contention; raise default to 5s.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  __resetAccountLocalPreferencesForTests();
  // The kv-store mock below keeps one store per test file; start each test
  // empty. The launch theme was read at import, before any test.
  (jest.requireMock('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store')).Storage.clearSync();
});

afterEach(() => {
  cleanup();
});

// Worklets installs its native runtime on import; Jest has none, so any suite
// that loads reanimated (the root layout does) uses the library's own mock.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));

// react-native-gesture-handler's native runtime and dev-only RootView assertions
// are not needed in unit tests; provide lightweight stubs.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');

  const chainable = () => {
    const obj: Record<string, unknown> = {};
    const methods = [
      'activeOffsetX', 'activeOffsetY', 'failOffsetX', 'failOffsetY',
      'onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize',
      'minDistance', 'maxPointers', 'minPointers', 'enabled', 'shouldCancelWhenOutside',
    ];
    for (const m of methods) {
      obj[m] = () => obj;
    }
    return obj;
  };

  return {
    GestureHandlerRootView: ({ children, ...props }: { children?: unknown }) =>
      React.createElement(View, props, children),
    GestureDetector: ({ children }: { children?: unknown }) => children ?? null,
    Gesture: {
      Pan: () => chainable(),
      Tap: () => chainable(),
      Pinch: () => chainable(),
      Rotation: () => chainable(),
      Fling: () => chainable(),
      LongPress: () => chainable(),
      Manual: () => chainable(),
      Native: () => chainable(),
      Race: () => chainable(),
      Simultaneous: () => chainable(),
      Exclusive: () => chainable(),
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const { View, Text, Image, ScrollView } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
      Text,
      Image,
      ScrollView,
      createAnimatedComponent: (c: unknown) => c,
    },
    View,
    Text,
    Image,
    ScrollView,
    createAnimatedComponent: (c: unknown) => c,
    useSharedValue: (init: unknown) => ({ value: init }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (toValue: unknown) => toValue,
    withSpring: (toValue: unknown) => toValue,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

// expo-sqlite's key-value store needs the native SQLite module, which Jest does
// not have. An in-memory store per test file: the chosen theme preset
// (`components/ui/theme-launch.ts`) is read from it when `tokens.ts` loads, so
// every suite starts in the default theme unless it sets the key before
// importing tokens.
jest.mock('expo-sqlite/kv-store', () => {
  const items = new Map<string, string>();
  const Storage = {
    getItemSync: (key: string) => items.get(key) ?? null,
    getItem: async (key: string) => items.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      items.set(key, value);
    },
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
    removeItemSync: (key: string) => items.delete(key),
    clearSync: () => items.clear(),
  };
  return { __esModule: true, Storage, AsyncStorage: Storage, default: Storage };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const passthrough = ({ children }: { children?: unknown }) => children;
  const viewWrap = ({ children, ...props }: { children?: unknown }) =>
    React.createElement(View, props, children);
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 0, height: 0 };
  return {
    // expo-router's Stack reads these through `use()` (SafeAreaProviderCompat).
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    SafeAreaProvider: passthrough,
    SafeAreaConsumer: ({ children }: { children: (insets: object) => unknown }) =>
      children({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaView: viewWrap,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 0, height: 0 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  };
});

// Safety floor: never let a suite construct a REAL Supabase client.
//
// The app wrapper (`src/auth/supabase.ts`) calls `createClient(...)` with
// `autoRefreshToken: true`, which starts a GoTrue refresh `setInterval` — a
// live timer that keeps the Node process alive and makes Jest hang at exit
// (this config runs WITHOUT `--forceExit`, by design). Today every suite that
// touches auth mocks it, but that is correct-by-discipline: one forgotten mock
// (or a new transitive import) would load the real transport and reintroduce
// the silent hang. Mocking `createClient` here makes the safe state the
// DEFAULT — the returned client opens no socket and starts no timer. Suites
// that need richer behaviour still override this with their own `jest.mock`
// (e.g. auth-service mocks `@supabase/supabase-js` directly; a test-file mock
// takes precedence over this setup-file one).
jest.mock('@supabase/supabase-js', () => {
  const resolved = (data: unknown = null) => Promise.resolve({ data, error: null });

  const makeQueryBuilder = () => {
    const builder: Record<string, unknown> = {};
    const chainable = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
      'in', 'is', 'match', 'filter', 'order', 'limit', 'range',
    ];
    for (const method of chainable) {
      builder[method] = jest.fn(() => builder);
    }
    builder.single = jest.fn(() => resolved(null));
    builder.maybeSingle = jest.fn(() => resolved(null));
    // `await sb.from('t').select()...` awaits the builder itself → empty result.
    builder.then = (onFulfilled: (value: unknown) => unknown) =>
      resolved([]).then(onFulfilled);
    return builder;
  };

  const channel: { on: jest.Mock; subscribe: jest.Mock; unsubscribe: jest.Mock } = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
    unsubscribe: jest.fn(() => resolved()),
  };

  const inertClient = {
    auth: {
      getSession: jest.fn(() => resolved({ session: null })),
      getUser: jest.fn(() => resolved({ user: null })),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      signInWithPassword: jest.fn(() => resolved({ user: null, session: null })),
      signInWithOtp: jest.fn(() => resolved({ user: null, session: null })),
      signOut: jest.fn(() => resolved()),
      refreshSession: jest.fn(() => resolved({ session: null })),
      setSession: jest.fn(() => resolved({ session: null })),
      updateUser: jest.fn(() => resolved({ user: null })),
    },
    from: jest.fn(() => makeQueryBuilder()),
    rpc: jest.fn(() => resolved(null)),
    channel: jest.fn(() => channel),
    removeChannel: jest.fn(() => resolved()),
    removeAllChannels: jest.fn(() => resolved()),
    getChannels: jest.fn(() => []),
  };

  return {
    __esModule: true,
    createClient: jest.fn(() => inertClient),
  };
});
