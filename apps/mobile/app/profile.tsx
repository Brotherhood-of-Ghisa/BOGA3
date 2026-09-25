import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  FormField,
  Notice,
  ScreenScroll,
  StatePanel,
  Stat,
  uiBorder,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import { loadUserProfile, saveUsername, type UserProfileRecord } from '@/src/auth/profile';

const EMPTY_FORM_ERROR = 'Enter your email and password to continue.';
const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_PENDING_MESSAGE =
  'Email change submitted. Confirm the change from your email inbox before it fully takes effect.';
const PROFILE_UPDATED_MESSAGE = 'Profile updated.';
const NO_PROFILE_CHANGES_ERROR = 'No changes to update.';

type InlineFeedback = {
  message: string;
  tone: 'error' | 'success';
};

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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [profileUpdateFeedback, setProfileUpdateFeedback] = useState<InlineFeedback | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const inlineError = signOutError ?? formError ?? lastError ?? null;
  const authDisabledMessage = !isConfigured ? disabledReason ?? 'Supabase mobile auth is not configured.' : null;
  const isAuthRestoring = status === 'restoring';
  const isBusy = isSubmitting || isSigningOut || isAuthRestoring;
  const currentUserId = user?.id ?? null;
  const currentUserEmail = user?.email?.trim() ?? '';
  const userEmail = user?.email?.trim() || 'Email unavailable';
  const pendingEmail = user?.new_email?.trim() || null;
  const profileUsernameValue = profile?.username?.trim() || 'Not set';

  useEffect(() => {
    if (!currentUserId) {
      setProfile(null);
      setProfileError(null);
      setUsername('');
      setProfileUpdateFeedback(null);
      setNewEmail('');
      setNewPassword('');
      setIsEditingProfile(false);
      return;
    }

    setPassword('');
    setFormError(null);
    setSignOutError(null);
    setProfileError(null);
    setProfileUpdateFeedback(null);
    setNewEmail(currentUserEmail);
    setNewPassword('');
    setIsEditingProfile(false);
  }, [currentUserEmail, currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    let isActive = true;

    setIsLoadingProfile(true);
    setProfileError(null);

    void loadUserProfile(currentUserId)
      .then(({ profile: loadedProfile }) => {
        if (!isActive) {
          return;
        }

        setProfile(loadedProfile);
        setUsername(loadedProfile.username ?? '');
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setProfile(null);
        setProfileError(error instanceof Error ? error.message : 'Unable to load profile right now.');
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingProfile(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [currentUserId]);

  const resetInlineErrors = () => {
    setFormError(null);
    setSignOutError(null);
    clearAuthError();
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    resetInlineErrors();
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    resetInlineErrors();
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    setProfileUpdateFeedback(null);
    setProfileError(null);
  };

  const handleEmailUpdateChange = (value: string) => {
    setNewEmail(value);
    setProfileUpdateFeedback(null);
  };

  const handlePasswordUpdateChange = (value: string) => {
    setNewPassword(value);
    setProfileUpdateFeedback(null);
  };

  const handleSignIn = async () => {
    if (isBusy) {
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setFormError(EMPTY_FORM_ERROR);
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setFormError(INVALID_EMAIL_ERROR);
      return;
    }

    resetInlineErrors();
    setIsSubmitting(true);

    try {
      await signInWithPassword({
        email: trimmedEmail,
        password,
      });
      setEmail(trimmedEmail);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to sign in right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (isBusy) {
      return;
    }

    resetInlineErrors();
    setIsSigningOut(true);

    try {
      await signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out right now.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleCancelProfileEdit = () => {
    setUsername(profile?.username ?? '');
    setNewEmail(currentUserEmail);
    setNewPassword('');
    setProfileUpdateFeedback(null);
    setIsEditingProfile(false);
  };

  const handleUpdateProfile = async () => {
    if (!user || isLoadingProfile || isUpdatingProfile) {
      return;
    }

    const usernameChanged = username.trim() !== (profile?.username ?? '');
    const trimmedEmail = newEmail.trim();
    const emailChanged = trimmedEmail.toLowerCase() !== currentUserEmail.toLowerCase();
    const passwordChanged = newPassword.length > 0;

    if (!usernameChanged && !emailChanged && !passwordChanged) {
      setProfileUpdateFeedback({
        message: NO_PROFILE_CHANGES_ERROR,
        tone: 'error',
      });
      return;
    }

    if (emailChanged && !EMAIL_PATTERN.test(trimmedEmail)) {
      setProfileUpdateFeedback({
        message: INVALID_EMAIL_ERROR,
        tone: 'error',
      });
      return;
    }

    setProfileError(null);
    setProfileUpdateFeedback(null);
    setIsUpdatingProfile(true);

    try {
      let emailPending = false;

      if (usernameChanged) {
        const updatedProfile = await saveUsername(user.id, username);
        setProfile(updatedProfile);
        setUsername(updatedProfile.username ?? '');
      }

      if (emailChanged) {
        const result = await updateUserEmail({
          email: trimmedEmail,
        });
        setNewEmail(trimmedEmail);
        emailPending = result.emailChangePending;
      }

      if (passwordChanged) {
        await updateUserPassword({
          password: newPassword,
        });
      }

      setProfileUpdateFeedback({
        message: emailPending ? EMAIL_PENDING_MESSAGE : PROFILE_UPDATED_MESSAGE,
        tone: 'success',
      });
      setIsEditingProfile(false);
    } catch (error) {
      setProfileUpdateFeedback({
        message: error instanceof Error ? error.message : 'Unable to update profile right now.',
        tone: 'error',
      });
    } finally {
      setNewPassword('');
      setIsUpdatingProfile(false);
    }
  };

  // A success is the `success` glyph and the words on the neutral band (G3); a
  // failure is the `danger` notice.
  const renderFeedback = (feedback: InlineFeedback | null, testID: string) => {
    if (!feedback) {
      return null;
    }

    return feedback.tone === 'error' ? (
      <Notice live message={feedback.message} testID={testID} tone="danger" />
    ) : (
      <Notice icon="success" live message={feedback.message} testID={testID} />
    );
  };

  const renderInlineError = () =>
    inlineError ? <Notice live message={inlineError} testID="profile-inline-error" tone="danger" /> : null;

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
        <Card style={styles.formCard} testID="profile-signed-out-card">
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Sign in
          </Text>

          <FormField
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoCorrect={false}
            face="text"
            keyboardType="email-address"
            label="Email"
            onChangeText={handleEmailChange}
            placeholder="you@example.com"
            testID="profile-email-input"
            textContentType="emailAddress"
            value={email}
          />

          <FormField
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoCorrect={false}
            face="text"
            label="Password"
            onChangeText={handlePasswordChange}
            placeholder="Enter password"
            secureTextEntry
            testID="profile-password-input"
            textContentType="password"
            value={password}
          />

          {renderInlineError()}

          <ActionButton
            accessibilityLabel="Sign in to profile"
            disabled={!isConfigured || isBusy}
            label={isSubmitting ? 'Signing in…' : 'Sign in'}
            onPress={() => {
              void handleSignIn();
            }}
            testID="profile-sign-in-button"
            variant="primary"
          />
        </Card>
      ) : (
        <View style={styles.profilePanel} testID="profile-signed-in-card">
          {isEditingProfile ? (
            <Card style={styles.formCard}>
              <FormField
                accessibilityLabel="Username"
                autoCapitalize="none"
                autoCorrect={false}
                face="text"
                label="Username"
                onChangeText={handleUsernameChange}
                placeholder="Add a username"
                testID="profile-username-input"
                value={username}
              />
              <FormField
                accessibilityLabel="New email"
                autoCapitalize="none"
                autoCorrect={false}
                face="text"
                keyboardType="email-address"
                label="New email"
                onChangeText={handleEmailUpdateChange}
                placeholder="you@example.com"
                testID="profile-email-update-input"
                textContentType="emailAddress"
                value={newEmail}
              />
              <FormField
                accessibilityLabel="New password"
                autoCapitalize="none"
                autoCorrect={false}
                face="text"
                label="New password"
                onChangeText={handlePasswordUpdateChange}
                placeholder="Enter a new password"
                secureTextEntry
                testID="profile-password-update-input"
                textContentType="newPassword"
                value={newPassword}
              />

              {/* Inline edit stays in place (T05-D2): Cancel steps back, Update
                  is the screen's one primary. */}
              <View style={styles.actionRow}>
                <ActionButton
                  accessibilityLabel="Cancel profile editing"
                  disabled={isUpdatingProfile}
                  label="Cancel"
                  onPress={handleCancelProfileEdit}
                  testID="profile-cancel-edit-button"
                  variant="text"
                />
                <View style={styles.actionFill}>
                  <ActionButton
                    accessibilityLabel="Update profile"
                    disabled={isLoadingProfile || isUpdatingProfile}
                    label={isUpdatingProfile ? 'Updating…' : 'Update'}
                    onPress={() => {
                      void handleUpdateProfile();
                    }}
                    testID="profile-update-button"
                    variant="primary"
                  />
                </View>
              </View>
            </Card>
          ) : (
            <>
              <Card>
                <View style={styles.valueRow}>
                  <Stat kind="text" label="Username" value={isLoadingProfile ? 'Loading...' : profileUsernameValue} />
                </View>
                <View style={[styles.valueRow, styles.valueRowDivider]}>
                  <Stat kind="text" label="Email" value={userEmail} />
                </View>
                {pendingEmail ? (
                  <View style={[styles.valueRow, styles.valueRowDivider]}>
                    <Stat kind="text" label="Pending email" value={pendingEmail} />
                  </View>
                ) : null}
              </Card>

              {/* Neither is the primary: Edit opens the form, and Sign out is an
                  outline in `danger` with no confirmation (T05-D4). */}
              <View style={styles.actionRow}>
                <View style={styles.actionFill}>
                  <ActionButton
                    accessibilityLabel="Edit profile"
                    disabled={isSigningOut || isUpdatingProfile || isLoadingProfile}
                    label="Edit"
                    onPress={() => {
                      setIsEditingProfile(true);
                    }}
                    testID="profile-edit-button"
                    variant="outline"
                  />
                </View>
                <View style={styles.actionFill}>
                  <ActionButton
                    accessibilityLabel="Sign out of profile"
                    disabled={isBusy || isUpdatingProfile}
                    label={isSigningOut ? 'Signing out…' : 'Sign out'}
                    onPress={() => {
                      void handleSignOut();
                    }}
                    testID="profile-sign-out-button"
                    tone="danger"
                    variant="outline"
                  />
                </View>
              </View>
            </>
          )}

          {profileError ? <Notice live message={profileError} testID="profile-load-error" tone="danger" /> : null}

          {renderFeedback(profileUpdateFeedback, 'profile-update-feedback')}

          {renderInlineError()}
        </View>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  formCard: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  cardTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  profilePanel: {
    gap: uiSpace.md,
  },
  valueRow: {
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
  },
  valueRowDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  actionFill: {
    flex: 1,
  },
});
