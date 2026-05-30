import { cleanup } from '@testing-library/react-native';

afterEach(() => {
  cleanup();
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const passthrough = ({ children }: { children?: unknown }) => children;
  const viewWrap = ({ children, ...props }: { children?: unknown }) =>
    React.createElement(View, props, children);
  return {
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
