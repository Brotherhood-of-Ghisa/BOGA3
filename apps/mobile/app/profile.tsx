import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiBorder, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
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

  const renderFeedbackCard = (feedback: InlineFeedback | null, testID: string) => {
    if (!feedback) {
      return null;
    }

    const isError = feedback.tone === 'error';

    return (
      <UiSurface style={[styles.feedbackCard, isError ? styles.errorCard : styles.successCard]} testID={testID}>
        <UiText selectable style={isError ? styles.errorText : styles.successText} variant="body">
          {feedback.message}
        </UiText>
      </UiSurface>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      testID="profile-screen">
      {status === 'restoring' ? (
        <UiSurface style={styles.infoCard} testID="profile-restoring-state">
          <UiText selectable variant="label">
            Restoring account session...
          </UiText>
          <UiText selectable variant="bodyMuted">
            The profile route will switch to the correct signed-in state as soon as auth bootstrap completes.
          </UiText>
        </UiSurface>
      ) : null}

      {authDisabledMessage ? (
        <UiSurface style={styles.warningCard} testID="profile-auth-disabled-card" variant="panelMuted">
          <UiText selectable variant="label">
            Auth setup required
          </UiText>
          <UiText selectable style={styles.warningText} variant="body">
            {authDisabledMessage}
          </UiText>
        </UiSurface>
      ) : null}

      {!user ? (
        <UiSurface style={styles.card} testID="profile-signed-out-card">
          <View style={styles.sectionHeader}>
            <UiText selectable variant="labelStrong">
              Sign in
            </UiText>
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.fieldBlock}>
              <UiText selectable variant="subtitle">
                Email
              </UiText>
              <TextInput
                accessibilityLabel="Email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={handleEmailChange}
                placeholder="you@example.com"
                placeholderTextColor={uiColors.textDisabled}
                style={styles.input}
                testID="profile-email-input"
                textContentType="emailAddress"
                value={email}
              />
            </View>

            <View style={styles.fieldBlock}>
              <UiText selectable variant="subtitle">
                Password
              </UiText>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={handlePasswordChange}
                placeholder="Enter password"
                placeholderTextColor={uiColors.textDisabled}
                secureTextEntry
                style={styles.input}
                testID="profile-password-input"
                textContentType="password"
                value={password}
              />
            </View>
          </View>

          {inlineError ? (
            <UiSurface style={[styles.feedbackCard, styles.errorCard]} testID="profile-inline-error">
              <UiText selectable style={styles.errorText} variant="body">
                {inlineError}
              </UiText>
            </UiSurface>
          ) : null}

          <UiButton
            accessibilityLabel="Sign in to profile"
            disabled={!isConfigured || isBusy}
            label={isSubmitting ? 'Signing In...' : 'Sign In'}
            onPress={() => {
              void handleSignIn();
            }}
            testID="profile-sign-in-button"
          />
        </UiSurface>
      ) : (
        <View style={styles.profilePanel} testID="profile-signed-in-card">
          {isEditingProfile ? (
            <>
              <View style={styles.editFields}>
                <View style={styles.fieldBlock}>
                  <UiText selectable variant="subtitle">
                    Username
                  </UiText>
                  <TextInput
                    accessibilityLabel="Username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={handleUsernameChange}
                    placeholder="Add a username"
                    placeholderTextColor={uiColors.textDisabled}
                    style={styles.input}
                    testID="profile-username-input"
                    value={username}
                  />
                </View>
                <View style={styles.fieldBlock}>
                  <UiText selectable variant="subtitle">
                    New email
                  </UiText>
                  <TextInput
                    accessibilityLabel="New email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onChangeText={handleEmailUpdateChange}
                    placeholder="you@example.com"
                    placeholderTextColor={uiColors.textDisabled}
                    style={styles.input}
                    testID="profile-email-update-input"
                    textContentType="emailAddress"
                    value={newEmail}
                  />
                </View>
                <View style={styles.fieldBlock}>
                  <UiText selectable variant="subtitle">
                    New password
                  </UiText>
                  <TextInput
                    accessibilityLabel="New password"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={handlePasswordUpdateChange}
                    placeholder="Enter a new password"
                    placeholderTextColor={uiColors.textDisabled}
                    secureTextEntry
                    style={styles.input}
                    testID="profile-password-update-input"
                    textContentType="newPassword"
                    value={newPassword}
                  />
                </View>
              </View>
              <View style={styles.editActionRow}>
                <UiButton
                  accessibilityLabel="Cancel profile editing"
                  disabled={isUpdatingProfile}
                  label="Cancel"
                  onPress={handleCancelProfileEdit}
                  style={styles.profileActionButton}
                  testID="profile-cancel-edit-button"
                  variant="secondary"
                />
                <UiButton
                  accessibilityLabel="Update profile"
                  disabled={isLoadingProfile || isUpdatingProfile}
                  label={isUpdatingProfile ? 'Updating...' : 'Update'}
                  onPress={() => {
                    void handleUpdateProfile();
                  }}
                  style={styles.profileActionButton}
                  testID="profile-update-button"
                />
              </View>
            </>
          ) : (
            <>
              <View style={styles.valueList}>
                <View style={styles.valueRow}>
                  <UiText selectable style={styles.valueLabel} variant="subtitle">
                    Username
                  </UiText>
                  <UiText selectable style={styles.valueText} variant="label">
                    {isLoadingProfile ? 'Loading...' : profileUsernameValue}
                  </UiText>
                </View>
                <View style={[styles.valueRow, pendingEmail ? null : styles.valueRowLast]}>
                  <UiText selectable style={styles.valueLabel} variant="subtitle">
                    Email
                  </UiText>
                  <UiText selectable style={styles.valueText} variant="label">
                    {userEmail}
                  </UiText>
                </View>
                {pendingEmail ? (
                  <View style={[styles.valueRow, styles.valueRowLast]}>
                    <UiText selectable style={styles.valueLabel} variant="subtitle">
                      Pending email
                    </UiText>
                    <UiText selectable style={styles.valueText} variant="label">
                      {pendingEmail}
                    </UiText>
                  </View>
                ) : null}
              </View>

              <View style={styles.profileActionRow}>
                <UiButton
                  accessibilityLabel="Edit profile"
                  disabled={isSigningOut || isUpdatingProfile || isLoadingProfile}
                  label="Edit"
                  onPress={() => {
                    setIsEditingProfile(true);
                  }}
                  style={styles.profileActionButton}
                  testID="profile-edit-button"
                  variant="secondary"
                />
                <UiButton
                  accessibilityLabel="Sign out of profile"
                  disabled={isBusy || isUpdatingProfile}
                  label={isSigningOut ? 'Signing Out...' : 'Sign Out'}
                  onPress={() => {
                    void handleSignOut();
                  }}
                  style={styles.profileActionButton}
                  testID="profile-sign-out-button"
                  variant="danger"
                />
              </View>
            </>
          )}

          {profileError ? (
            <UiSurface style={[styles.feedbackCard, styles.errorCard]} testID="profile-load-error">
              <UiText selectable style={styles.errorText} variant="body">
                {profileError}
              </UiText>
            </UiSurface>
          ) : null}

          {renderFeedbackCard(profileUpdateFeedback, 'profile-update-feedback')}

          {inlineError ? (
            <UiSurface style={[styles.feedbackCard, styles.errorCard]} testID="profile-inline-error">
              <UiText selectable style={styles.errorText} variant="body">
                {inlineError}
              </UiText>
            </UiSurface>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.screen,
    gap: uiSpace.xxl,
  },
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.xxl,
  },
  infoCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.sm,
    backgroundColor: uiColors.surfaceInfo,
    borderColor: uiColors.actionPrimarySubtleBorder,
  },
  warningCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.sm,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
  },
  warningText: {
    color: uiColors.textWarning,
  },
  sectionHeader: {
    gap: uiSpace.sm,
  },
  profilePanel: {
    gap: uiSpace.xl,
  },
  profileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  profileActionButton: {
    flex: 1,
  },
  valueList: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    overflow: 'hidden',
  },
  valueRow: {
    alignItems: 'flex-start',
    paddingHorizontal: uiSpace.xxl,
    paddingVertical: uiSpace.lg,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiColors.borderMuted,
    gap: uiSpace.xs,
  },
  valueRowLast: {
    borderBottomWidth: 0,
  },
  valueLabel: {
    color: uiColors.textSecondary,
  },
  valueText: {
    color: uiColors.textAccentStrong,
    flexShrink: 1,
    textAlign: 'left',
  },
  editFields: {
    gap: uiSpace.xl,
  },
  editActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  fieldGroup: {
    gap: uiSpace.xl,
  },
  fieldBlock: {
    gap: uiSpace.sm,
  },
  input: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderInputStrong,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    color: uiColors.textPrimary,
    minHeight: 48,
    paddingHorizontal: uiSpace.xxl,
    paddingVertical: uiSpace.lg,
    fontSize: uiTypography.size.base,
  },
  feedbackCard: {
    paddingHorizontal: uiSpace.xxl,
    paddingVertical: uiSpace.xl,
  },
  errorCard: {
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  successCard: {
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  errorText: {
    color: uiColors.actionDangerText,
  },
  successText: {
    color: uiColors.textSuccess,
  },
});
