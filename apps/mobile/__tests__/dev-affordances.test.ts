/* eslint-disable import/first */

// The destructive helpers must be inert in release builds, so every behaviour
// here pivots on the dev-mode gate. The data-layer and Supabase-client
// collaborators are mocked so the tests assert orchestration (what gets called,
// in what order, and what throws) without touching native SQLite or a network.

const mockIsDevMode = jest.fn();
const mockResetLocalAppData = jest.fn();
const mockBootstrapLocalDataLayer = jest.fn();
const mockRpc = jest.fn();
// Records the schema name the helper selects before dispatching the RPC. The
// wipe RPC lives in a non-default Postgres schema, so the client MUST select it
// (`client.schema(<name>).rpc(...)`) — a bare `.rpc(...)` on the default schema
// silently never resolves the function. `mockSchema` captures the argument so a
// test can pin the exact schema, while still returning the same `rpc` spy so the
// dispatch and error-handling assertions are unaffected.
const mockSchema = jest.fn((..._args: unknown[]) => ({ rpc: mockRpc }));
const mockGetRequiredClient = jest.fn(() => ({
  rpc: mockRpc,
  schema: (...args: unknown[]) => mockSchema(...args),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

jest.mock('@/src/data/bootstrap', () => ({
  resetLocalAppData: (...args: unknown[]) => mockResetLocalAppData(...args),
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => mockGetRequiredClient(),
}));

import {
  wipeLocalAndReBootstrap,
  wipeRemoteForCurrentUser,
} from '@/src/sync/dev-affordances';

describe('dev wipe affordances', () => {
  beforeEach(() => {
    mockIsDevMode.mockReset();
    mockResetLocalAppData.mockReset().mockResolvedValue(undefined);
    mockBootstrapLocalDataLayer.mockReset().mockResolvedValue(undefined);
    mockRpc.mockReset().mockResolvedValue({ data: 0, error: null });
    mockSchema.mockClear();
    mockGetRequiredClient.mockClear();
  });

  describe('wipeLocalAndReBootstrap', () => {
    it('throws synchronously when not in dev mode and does no I/O', () => {
      mockIsDevMode.mockReturnValue(false);

      // Synchronous throw: the rejection is the call itself, not a returned
      // promise, so the destructive path is never entered in release builds.
      expect(() => wipeLocalAndReBootstrap()).toThrow(
        /developer-only tool/i
      );
      expect(mockResetLocalAppData).not.toHaveBeenCalled();
      expect(mockBootstrapLocalDataLayer).not.toHaveBeenCalled();
    });

    it('resets local data then re-bootstraps when in dev mode', async () => {
      mockIsDevMode.mockReturnValue(true);
      const order: string[] = [];
      mockResetLocalAppData.mockImplementation(async () => {
        order.push('reset');
      });
      mockBootstrapLocalDataLayer.mockImplementation(async () => {
        order.push('bootstrap');
      });

      await expect(wipeLocalAndReBootstrap()).resolves.toBeUndefined();

      expect(order).toEqual(['reset', 'bootstrap']);
    });
  });

  describe('wipeRemoteForCurrentUser', () => {
    it('throws synchronously when not in dev mode and never calls the RPC', () => {
      mockIsDevMode.mockReturnValue(false);

      expect(() => wipeRemoteForCurrentUser()).toThrow(/developer-only tool/i);
      expect(mockGetRequiredClient).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('calls the wipe RPC and returns the row count when in dev mode', async () => {
      mockIsDevMode.mockReturnValue(true);
      mockRpc.mockResolvedValue({ data: 42, error: null });

      const result = await wipeRemoteForCurrentUser();

      expect(mockRpc).toHaveBeenCalledWith('dev_wipe_my_data');
      expect(result).toEqual({ rowsDeleted: 42 });
    });

    it('selects the non-default schema before dispatching the RPC', async () => {
      mockIsDevMode.mockReturnValue(true);

      await wipeRemoteForCurrentUser();

      // The wipe function is exposed under `app_public`, not the default
      // `public` schema. A bare `.rpc(...)` would silently never reach it, so
      // the helper must select the schema first. Pin both the selection and its
      // exact name here.
      expect(mockSchema).toHaveBeenCalledWith('app_public');
      expect(mockSchema).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    it('normalizes an object-wrapped row count', async () => {
      mockIsDevMode.mockReturnValue(true);
      mockRpc.mockResolvedValue({ data: { rows_deleted: 7 }, error: null });

      await expect(wipeRemoteForCurrentUser()).resolves.toEqual({ rowsDeleted: 7 });
    });

    it('surfaces the RPC error message', async () => {
      mockIsDevMode.mockReturnValue(true);
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'FORBIDDEN_ENV: disabled outside non-prod' },
      });

      await expect(wipeRemoteForCurrentUser()).rejects.toThrow(
        'FORBIDDEN_ENV: disabled outside non-prod'
      );
    });
  });
});
