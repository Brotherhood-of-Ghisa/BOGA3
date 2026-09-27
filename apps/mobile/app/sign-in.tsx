import { Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, Card, FormField, Notice, PageHeader, uiRoles, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { clearAuthRequired } from '@/src/sync/auth-required-signal';

const EMPTY_FORM_ERROR = 'Enter your email and password to continue.';
const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dedicated sign-in entry point: while auth is configured and the user must sign
 * in, it is the only route the root stack declares, so no data screen renders. It
 * reuses the
 * signed-out credential pattern from the Profile screen (email + password +
 * inline error), so the launch gate introduces no new interaction pattern.
 *
 * On a successful sign-in the shared auth snapshot flips to a live session; the
 * root stack then removes this route and the router moves on to the first-sync
 * block or the app, so this screen needs no explicit navigation on success.
 *
 * When auth is unconfigured there is no working credential path, so the screen
 * shows the disabled-reason message instead of a form that cannot succeed. The
 * app routes stay open in that local-only state; this screen still documents the
 * missing credential path when opened directly.
 */
export default function SignInScreen() {
  const { clearAuthError, disabledReason, isConfigured, lastError, signInWithPassword, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isAuthRestoring = status === 'restoring';
  const isBusy = isSubmitting || isAuthRestoring;
  const inlineError = formError ?? lastError ?? null;
  const authDisabledMessage = !isConfigured ? disabledReason ?? 'Supabase mobile auth is not configured.' : null;

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
      // prior cycle raised so the root stack leaves sign-in immediately.
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
          <PageHeader intro="Sign in to load your data and keep it in sync." title="Sign in" />

          {authDisabledMessage ? (
            <Notice
              icon="warning"
              message={authDisabledMessage}
              testID="sign-in-auth-disabled-card"
              title="Sign-in unavailable"
            />
          ) : (
            <Card style={styles.card} testID="sign-in-card">
              <FormField
                accessibilityLabel="Email"
                autoCapitalize="none"
                autoCorrect={false}
                face="text"
                keyboardType="email-address"
                label="Email"
                onChangeText={handleEmailChange}
                placeholder="you@example.com"
                testID="sign-in-email-input"
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
                testID="sign-in-password-input"
                textContentType="password"
                value={password}
              />

              {inlineError ? <Notice live message={inlineError} testID="sign-in-inline-error" tone="danger" /> : null}

              <ActionButton
                accessibilityLabel="Sign in"
                disabled={!isConfigured || isBusy}
                label={isSubmitting ? 'Signing in…' : 'Sign in'}
                onPress={() => {
                  void handleSignIn();
                }}
                testID="sign-in-submit-button"
                variant="primary"
              />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  flex: {
    flex: 1,
  },
  // Centred on the page, so the form sits where the thumb is.
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: uiSpace.lg,
    gap: uiSpace.lg,
  },
  card: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
});
