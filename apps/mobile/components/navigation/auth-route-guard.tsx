import { Redirect, usePathname } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { useShouldRouteToSignIn } from '@/src/sync/use-auth-required-redirect';

/** The dedicated sign-in entry point this guard sends unauthenticated users to. */
const SIGN_IN_ROUTE = '/sign-in';

/**
 * Route-layer auth gate. Wraps the whole navigator so it decides, before any
 * data screen paints, whether the user may proceed:
 *
 *   - While the session restore is in flight (`restoring`), it renders a neutral
 *     loading view. It does NOT flash the sign-in screen or a data screen — the
 *     decision is deferred until auth resolves.
 *   - Once resolved, if the app needs a session (auth configured + no session,
 *     or a sync cycle reported "no signed-in user"), it redirects to the sign-in
 *     route. A configured-but-signed-out launch therefore never reaches a data
 *     screen.
 *   - Otherwise (signed in) it renders its children untouched. An unconfigured
 *     auth client is still routed to sign-in so the missing credential path is
 *     visible instead of silently allowing local-only app usage.
 *
 * The sign-in route itself is exempt: the guard renders it through rather than
 * redirecting to it, so the redirect cannot loop.
 */
export function AuthRouteGuard({ children }: PropsWithChildren) {
  const { isConfigured, session, status } = useAuth();
  const pathname = usePathname();

  const shouldRouteToSignIn = useShouldRouteToSignIn({ isConfigured, session });

  // The session restore has not finished. Show a neutral placeholder rather than
  // committing to either the sign-in screen or a data screen — either choice
  // could be wrong and would flash the moment auth resolves.
  if (status === 'restoring') {
    return (
      <View style={styles.loadingContainer} testID="auth-guard-loading">
        <ActivityIndicator color={uiColors.textPrimary} size="large" />
        <UiText style={styles.loadingLabel} variant="bodyMuted">
          Loading…
        </UiText>
      </View>
    );
  }

  const isOnSignInRoute = pathname === SIGN_IN_ROUTE;

  if (shouldRouteToSignIn && !isOnSignInRoute) {
    return <Redirect href={SIGN_IN_ROUTE} />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.lg,
    backgroundColor: uiColors.surfacePage,
  },
  loadingLabel: {
    color: uiColors.textSecondary,
  },
});
