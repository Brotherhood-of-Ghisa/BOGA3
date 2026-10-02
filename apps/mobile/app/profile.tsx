import { useState } from 'react';
import { View } from 'react-native';

import {
  InlineError,
  ProfileEditForm,
  ProfileFeedback,
  ProfileSummary,
  profileStyles,
  SignedOutCard,
} from '@/components/profile/profile-cards';
import { useProfilePanel } from '@/components/profile/use-profile-panel';
import { useSessionForms } from '@/components/profile/use-session-forms';
import { Card, Notice, ScreenScroll, StatePanel } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { describeAccount, profileUsernameLabel } from '@/src/auth/profile-form-model';

export default function ProfileScreen() {
  const {
    clearAuthError,
    disabledReason,
    isConfigured,
    lastError,
    signInWithPassword,
    signOut,
    status,
    updateUserEmail,
    updateUserPassword,
    user,
  } = useAuth();
  const { currentUserId, currentUserEmail, userEmail, pendingEmail } = describeAccount(user);
  const session = useSessionForms({ signInWithPassword, signOut, clearAuthError, isAuthRestoring: status === 'restoring' });
  const panel = useProfilePanel({ userId: currentUserId, currentUserEmail, updateUserEmail, updateUserPassword });

  // Signing in, out, or to another account (or a confirmed email change)
  // resets the forms in the render that sees it.
  const accountKey = JSON.stringify([currentUserId, currentUserEmail]);
  const [shownAccountKey, setShownAccountKey] = useState<string | null>(null);
  if (shownAccountKey !== accountKey) {
    setShownAccountKey(accountKey);
    if (!currentUserId) {
      panel.resetForSignedOut();
    } else {
      session.resetForSignedIn();
      panel.resetForSignedIn(currentUserEmail);
    }
  }

  const inlineError = session.signOutError ?? session.formError ?? lastError ?? null;
  const authDisabledMessage = !isConfigured ? disabledReason ?? 'Supabase mobile auth is not configured.' : null;

  return (
    <ScreenScroll
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      testID="profile-screen">
      {status === 'restoring' ? (
        <Card>
          <StatePanel
            body="The profile route will switch to the correct signed-in state as soon as auth bootstrap completes."
            fill={false}
            kind="loading"
            testID="profile-restoring-state"
            title="Restoring account session..."
          />
        </Card>
      ) : null}

      {authDisabledMessage ? (
        <Notice
          icon="warning"
          message={authDisabledMessage}
          testID="profile-auth-disabled-card"
          title="Auth setup required"
        />
      ) : null}

      {!user ? (
        <SignedOutCard
          disabled={!isConfigured || session.isBusy}
          email={session.email}
          inlineError={inlineError}
          isSubmitting={session.isSubmitting}
          onChangeEmail={session.changeEmail}
          onChangePassword={session.changePassword}
          onSignIn={() => {
            void session.signIn();
          }}
          password={session.password}
        />
      ) : (
        <View style={profileStyles.profilePanel} testID="profile-signed-in-card">
          {panel.isEditingProfile ? (
            <ProfileEditForm
              isUpdating={panel.isUpdatingProfile}
              newEmail={panel.newEmail}
              newPassword={panel.newPassword}
              onCancel={panel.cancelEditing}
              onChangeNewEmail={panel.changeNewEmail}
              onChangeNewPassword={panel.changeNewPassword}
              onChangeUsername={panel.changeUsername}
              onUpdate={() => {
                void panel.update();
              }}
              updateDisabled={panel.isLoadingProfile || panel.isUpdatingProfile}
              username={panel.username}
            />
          ) : (
            <ProfileSummary
              editDisabled={session.isSigningOut || panel.isUpdatingProfile || panel.isLoadingProfile}
              email={userEmail}
              isSigningOut={session.isSigningOut}
              onEdit={panel.startEditing}
              onSignOut={() => {
                void session.signOut();
              }}
              pendingEmail={pendingEmail}
              signOutDisabled={session.isBusy || panel.isUpdatingProfile}
              username={panel.isLoadingProfile ? 'Loading...' : profileUsernameLabel(panel.profile)}
            />
          )}

          {panel.profileError ? <Notice live message={panel.profileError} testID="profile-load-error" tone="danger" /> : null}

          <ProfileFeedback feedback={panel.feedback} />

          <InlineError message={inlineError} />
        </View>
      )}
    </ScreenScroll>
  );
}
