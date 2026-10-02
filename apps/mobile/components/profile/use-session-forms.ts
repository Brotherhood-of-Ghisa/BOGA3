import { useState } from 'react';

import type { useAuth } from '@/src/auth';
import { checkSignIn, errorMessage } from '@/src/auth/profile-form-model';

type SessionAuth = Pick<ReturnType<typeof useAuth>, 'signInWithPassword' | 'signOut' | 'clearAuthError'>;

/** The sign-in form and sign-out, each with its own inline error. */
export function useSessionForms({ signInWithPassword, signOut, clearAuthError, isAuthRestoring }: SessionAuth & {
  isAuthRestoring: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const isBusy = isSubmitting || isSigningOut || isAuthRestoring;

  const resetInlineErrors = () => {
    setFormError(null);
    setSignOutError(null);
    clearAuthError();
  };

  const signIn = async () => {
    if (isBusy) return;
    const check = checkSignIn(email, password);
    if (!check.ok) {
      setFormError(check.error);
      return;
    }
    resetInlineErrors();
    setIsSubmitting(true);
    try {
      await signInWithPassword({ email: check.email, password });
      setEmail(check.email);
    } catch (error) {
      setFormError(errorMessage(error, 'Unable to sign in right now.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOutOfAccount = async () => {
    if (isBusy) return;
    resetInlineErrors();
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(errorMessage(error, 'Unable to sign out right now.'));
    } finally {
      setIsSigningOut(false);
    }
  };

  return {
    email,
    password,
    isSubmitting,
    isSigningOut,
    isBusy,
    formError,
    signOutError,
    changeEmail: (value: string) => { setEmail(value); resetInlineErrors(); },
    changePassword: (value: string) => { setPassword(value); resetInlineErrors(); },
    signIn,
    signOut: signOutOfAccount,
    /** A signed-in account starts without the sign-in password or either error. The email is kept. */
    resetForSignedIn: () => { setPassword(''); setFormError(null); setSignOutError(null); },
  };
}
