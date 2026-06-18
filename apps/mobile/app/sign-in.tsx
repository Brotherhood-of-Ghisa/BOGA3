import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UiButton, UiSurface, UiText, uiBorder, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { clearAuthRequired } from '@/src/sync/auth-required-signal';

const EMPTY_FORM_ERROR = 'Enter your email and password to continue.';
const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dedicated sign-in entry point the route-layer auth guard sends an
 * unauthenticated user to before any data screen renders. It reuses the
 * signed-out credential pattern from the Profile screen (email + password +
 * inline error), so the launch gate introduces no new interaction pattern.
 *
 * On a successful sign-in the shared auth snapshot flips to a live session; the
 * guard re-renders and lets the app proceed to its normal route, so this screen
 * needs no explicit navigation on success.
 *
 * When auth is unconfigured there is no working credential path, so the screen
 * shows the disabled-reason message instead of a form that cannot succeed. The
 * route guard intentionally sends users here even in that misconfigured state so
 * the app fails closed instead of allowing data routes without login.
 */
export default function SignInScreen() {
  const { clearAuthError, disabledReason, isConfigured, lastError, session, signInWithPassword, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isAuthRestoring = status === 'restoring';
  const isBusy = isSubmitting || isAuthRestoring;
  const inlineError = formError ?? lastError ?? null;
  const authDisabledMessage = !isConfigured ? disabledReason ?? 'Supabase mobile auth is not configured.' : null;

  // Already signed in: nothing to do here. Leave the gate so the normal route
  // takes over (covers a back-navigation onto this route while authenticated).
  if (isConfigured && session) {
    return <Redirect href="/" />;
  }

  const resetInlineError = () => {
    setFormError(null);
    clearAuthError();
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    resetInlineError();
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    resetInlineError();
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

    resetInlineError();
    setIsSubmitting(true);

    try {
      await signInWithPassword({ email: trimmedEmail, password });
      // A live session now exists; lower any stale "no signed-in user" flag a
      // prior cycle raised so the guard stops routing back here immediately.
      clearAuthRequired();
      setEmail(trimmedEmail);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to sign in right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea} testID="sign-in-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          style={styles.flex}>
          <View style={styles.header}>
            <UiText variant="title">Sign in</UiText>
            <UiText style={styles.subtitle} variant="bodyMuted">
              Sign in to load your data and keep it in sync.
            </UiText>
          </View>

          {authDisabledMessage ? (
            <UiSurface style={styles.warningCard} testID="sign-in-auth-disabled-card" variant="panelMuted">
              <UiText variant="label">Sign-in unavailable</UiText>
              <UiText style={styles.warningText} variant="body">
                {authDisabledMessage}
              </UiText>
            </UiSurface>
          ) : (
            <UiSurface style={styles.card} testID="sign-in-card">
              <View style={styles.fieldGroup}>
                <View style={styles.fieldBlock}>
                  <UiText variant="subtitle">Email</UiText>
                  <TextInput
                    accessibilityLabel="Email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onChangeText={handleEmailChange}
                    placeholder="you@example.com"
                    placeholderTextColor={uiColors.textDisabled}
                    style={styles.input}
                    testID="sign-in-email-input"
                    textContentType="emailAddress"
                    value={email}
                  />
                </View>

                <View style={styles.fieldBlock}>
                  <UiText variant="subtitle">Password</UiText>
                  <TextInput
                    accessibilityLabel="Password"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={handlePasswordChange}
                    placeholder="Enter password"
                    placeholderTextColor={uiColors.textDisabled}
                    secureTextEntry
                    style={styles.input}
                    testID="sign-in-password-input"
                    textContentType="password"
                    value={password}
                  />
                </View>
              </View>

              {inlineError ? (
                <UiSurface style={[styles.feedbackCard, styles.errorCard]} testID="sign-in-inline-error">
                  <UiText style={styles.errorText} variant="body">
                    {inlineError}
                  </UiText>
                </UiSurface>
              ) : null}

              <UiButton
                accessibilityLabel="Sign in"
                disabled={!isConfigured || isBusy}
                label={isSubmitting ? 'Signing In...' : 'Sign In'}
                onPress={() => {
                  void handleSignIn();
                }}
                testID="sign-in-submit-button"
              />
            </UiSurface>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: uiSpace.screen,
    gap: uiSpace.xxl,
  },
  header: {
    gap: uiSpace.sm,
  },
  subtitle: {
    color: uiColors.textSecondary,
  },
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.xxl,
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
  errorText: {
    color: uiColors.actionDangerText,
  },
});
