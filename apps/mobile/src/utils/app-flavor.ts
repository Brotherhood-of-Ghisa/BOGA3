import * as Application from 'expo-application';

import { DEV_BUNDLE_ID } from '@/src/utils/isDevMode';

/**
 * Native bundle id of the EAS `prod` build profile — the full App Store app —
 * in `apps/mobile/eas.json`. Exported so a test can pin the two together and
 * fail CI if they drift apart (mirrors {@link DEV_BUNDLE_ID}).
 */
export const PROD_BUNDLE_ID = 'com.phano.boga3';

/**
 * Coarse deployment flavor of the running build:
 *   - `production` — the full App Store app (`com.phano.boga3`).
 *   - `preview`    — the internal / TestFlight build (`com.phano.boga3.dev`).
 *                    The EAS `preview` and `dev` profiles share this bundle id
 *                    and the same Supabase backend, so they share a flavor.
 *   - `local`      — anything else: `expo start` / `dev-remote.sh` dev clients
 *                    (default bundle `com.anonymous.boga3`) and unknown ids.
 */
export type AppFlavor = 'production' | 'preview' | 'local';

/**
 * Resolves the deployment flavor from the native bundle id — the only runtime
 * signal that separates Preview from Full, since `eas.json` sets `APP_ENV=prod`
 * for both profiles.
 */
export const getAppFlavor = (): AppFlavor => {
  switch (Application.applicationId) {
    case PROD_BUNDLE_ID:
      return 'production';
    case DEV_BUNDLE_ID:
      return 'preview';
    default:
      return 'local';
  }
};

/**
 * Storage-key namespace for the persisted Supabase auth session, scoped per
 * flavor. supabase-js otherwise derives the key from the backend URL
 * (`sb-<hostname-label>-auth-token`), so the session is "lost" whenever the URL
 * changes — e.g. a local build switching localhost ↔ LAN ↔ tailnet. Keying by
 * flavor keeps the session stable across URL changes within a deployment while
 * still isolating Preview / Full / local builds (which target different
 * backends) from reading one another's session.
 */
export const getAuthStorageKey = (): string => `boga3-auth-${getAppFlavor()}`;
