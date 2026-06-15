/**
 * The id of the currently authenticated user, mirrored here by the auth service
 * on every auth-state transition (`auth/service.ts` → `setLoggingUserId`).
 *
 * Logging reads this synchronously to (a) stamp `user_id` on each record at log
 * time and (b) gate the Supabase flush on being signed in — without importing
 * the auth module. That keeps the dependency one-directional (auth → logging),
 * which is the constraint that `logEvent` must never import auth state (a
 * circular import). `null` means signed out / not yet restored.
 */
let currentUserId: string | null = null;

export const setLoggingUserId = (userId: string | null): void => {
  currentUserId = userId;
};

export const getLoggingUserId = (): string | null => currentUserId;

export const __resetLoggingUserIdForTests = (): void => {
  currentUserId = null;
};
