import { useEffect, useState } from 'react';

import type { useAuth } from '@/src/auth';
import { loadUserProfile, saveUsername, type UserProfileRecord } from '@/src/auth/profile';
import {
  EMAIL_PENDING_MESSAGE,
  errorMessage,
  planProfileUpdate,
  PROFILE_UPDATED_MESSAGE,
} from '@/src/auth/profile-form-model';

export type InlineFeedback = { message: string; tone: 'error' | 'success' };

type ProfileAuth = Pick<ReturnType<typeof useAuth>, 'updateUserEmail' | 'updateUserPassword'>;

/**
 * The signed-in profile: its load (shown loading in the render that sees the
 * user, fetched by the effect) and the inline edit form that updates the
 * username, email and password.
 */
export function useProfilePanel({ userId, currentUserEmail, updateUserEmail, updateUserPassword }: ProfileAuth & {
  userId: string | null;
  currentUserEmail: string;
}) {
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<InlineFeedback | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [profileLoadFor, setProfileLoadFor] = useState<string | null>(null);
  if (profileLoadFor !== userId) {
    setProfileLoadFor(userId);
    if (userId) {
      setIsLoadingProfile(true);
      setProfileError(null);
    }
  }

  useEffect(() => {
    if (!userId) {
      return;
    }
    let isActive = true;
    void loadUserProfile(userId)
      .then(({ profile: loadedProfile }) => {
        if (!isActive) return;
        setProfile(loadedProfile);
        setUsername(loadedProfile.username ?? '');
      })
      .catch((error) => {
        if (!isActive) return;
        setProfile(null);
        setProfileError(errorMessage(error, 'Unable to load profile right now.'));
      })
      .finally(() => {
        if (isActive) setIsLoadingProfile(false);
      });
    return () => {
      isActive = false;
    };
  }, [userId]);

  const update = async () => {
    if (!userId || isLoadingProfile || isUpdatingProfile) return;
    const plan = planProfileUpdate({
      username, savedUsername: profile?.username ?? '', newEmail, currentEmail: currentUserEmail, newPassword,
    });
    if (!plan.ok) {
      setFeedback({ message: plan.error, tone: 'error' });
      return;
    }
    setProfileError(null);
    setFeedback(null);
    setIsUpdatingProfile(true);
    try {
      let emailPending = false;
      if (plan.usernameChanged) {
        const updatedProfile = await saveUsername(userId, username);
        setProfile(updatedProfile);
        setUsername(updatedProfile.username ?? '');
      }
      if (plan.emailChanged) {
        const result = await updateUserEmail({ email: plan.email });
        setNewEmail(plan.email);
        emailPending = result.emailChangePending;
      }
      if (plan.passwordChanged) {
        await updateUserPassword({ password: newPassword });
      }
      setFeedback({ message: emailPending ? EMAIL_PENDING_MESSAGE : PROFILE_UPDATED_MESSAGE, tone: 'success' });
      setIsEditingProfile(false);
    } catch (error) {
      setFeedback({ message: errorMessage(error, 'Unable to update profile right now.'), tone: 'error' });
    } finally {
      setNewPassword('');
      setIsUpdatingProfile(false);
    }
  };

  return {
    profile,
    profileError,
    isLoadingProfile,
    isEditingProfile,
    isUpdatingProfile,
    username,
    feedback,
    newEmail,
    newPassword,
    changeUsername: (value: string) => { setUsername(value); setFeedback(null); setProfileError(null); },
    changeNewEmail: (value: string) => { setNewEmail(value); setFeedback(null); },
    changeNewPassword: (value: string) => { setNewPassword(value); setFeedback(null); },
    startEditing: () => setIsEditingProfile(true),
    cancelEditing: () => {
      setUsername(profile?.username ?? '');
      setNewEmail(currentUserEmail);
      setNewPassword('');
      setFeedback(null);
      setIsEditingProfile(false);
    },
    update,
    resetForSignedOut: () => {
      setProfile(null);
      setProfileError(null);
      setUsername('');
      setFeedback(null);
      setNewEmail('');
      setNewPassword('');
      setIsEditingProfile(false);
    },
    resetForSignedIn: (email: string) => {
      setProfileError(null);
      setFeedback(null);
      setNewEmail(email);
      setNewPassword('');
      setIsEditingProfile(false);
    },
  };
}
