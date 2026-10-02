// The profile route's decisions, as plain functions: what a sign-in or a
// profile update would send, or why it is refused, and how the account reads.
import type { UserProfileRecord } from './profile';

export const EMPTY_FORM_ERROR = 'Enter your email and password to continue.';
export const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
export const EMAIL_PENDING_MESSAGE =
  'Email change submitted. Confirm the change from your email inbox before it fully takes effect.';
export const PROFILE_UPDATED_MESSAGE = 'Profile updated.';
export const NO_PROFILE_CHANGES_ERROR = 'No changes to update.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An Error's own message, or the fallback for anything else thrown. */
export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export type SignInCheck = { ok: true; email: string } | { ok: false; error: string };

export const checkSignIn = (email: string, password: string): SignInCheck => {
  const trimmed = email.trim();
  if (!trimmed || !password) return { ok: false, error: EMPTY_FORM_ERROR };
  if (!EMAIL_PATTERN.test(trimmed)) return { ok: false, error: INVALID_EMAIL_ERROR };
  return { ok: true, email: trimmed };
};

export type ProfileUpdatePlan =
  | { ok: false; error: string }
  | { ok: true; usernameChanged: boolean; emailChanged: boolean; passwordChanged: boolean; email: string };

/** Which parts of the profile an Update would change; refused when nothing does or the new email is malformed. */
export const planProfileUpdate = ({ username, savedUsername, newEmail, currentEmail, newPassword }: {
  username: string; savedUsername: string; newEmail: string; currentEmail: string; newPassword: string;
}): ProfileUpdatePlan => {
  const usernameChanged = username.trim() !== savedUsername;
  const email = newEmail.trim();
  const emailChanged = email.toLowerCase() !== currentEmail.toLowerCase();
  const passwordChanged = newPassword.length > 0;
  if (!usernameChanged && !emailChanged && !passwordChanged) return { ok: false, error: NO_PROFILE_CHANGES_ERROR };
  if (emailChanged && !EMAIL_PATTERN.test(email)) return { ok: false, error: INVALID_EMAIL_ERROR };
  return { ok: true, usernameChanged, emailChanged, passwordChanged, email };
};

type AccountUser = { id: string; email?: string | null; new_email?: string | null } | null | undefined;

/** The signed-in account as the route identifies and displays it. */
export const describeAccount = (user: AccountUser) => ({
  currentUserId: user?.id ?? null,
  currentUserEmail: user?.email?.trim() ?? '',
  userEmail: user?.email?.trim() || 'Email unavailable',
  pendingEmail: user?.new_email?.trim() || null,
});

export const profileUsernameLabel = (profile: UserProfileRecord | null): string =>
  profile?.username?.trim() || 'Not set';
