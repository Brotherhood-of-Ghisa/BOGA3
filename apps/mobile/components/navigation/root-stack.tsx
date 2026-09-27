import { Stack } from 'expo-router';

import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import { useAuth } from '@/src/auth';
import { useRootRouteAccess } from '@/src/navigation/root-route-access';

/**
 * Arrow-only native back affordance on every detail screen. No custom
 * `headerBackTitle`: react-native-screens then builds a custom back item that
 * ignores the display mode and morphs its label in during the push. The
 * hidden back label (still read by VoiceOver) is the previous screen's title,
 * so the headerless `(tabs)` group is titled "Back" rather than "(tabs)".
 */
const ROOT_STACK_SCREEN_OPTIONS = {
  headerBackButtonDisplayMode: 'minimal',
  // One header style on every stack route, as the design-language top bars
  // draw it (`ux-rules` §8, `navigation-contract.md` "Header titles"):
  // `surface` over the page, an Archivo 700 `ink` title, an `ink` back arrow.
  headerStyle: { backgroundColor: uiRoles.surface },
  headerTitleStyle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    color: uiRoles.ink,
  },
  headerTintColor: uiRoles.ink,
} as const;

/**
 * The root stack. Every root route is declared here under exactly one
 * `Stack.Protected` group, and `useRootRouteAccess` enables one access level at a
 * time: `sign-in`, the first-sync block (`sync-setup`), or the app. When the level
 * changes, the routes of the old level leave the stack and the router lands on the
 * first route still declared, so group order matters: `index` leads the app group,
 * and the dev/test harness comes last so it is never where the router lands.
 *
 * The navigator is never unmounted to gate access (expo-router 57 reverts the route
 * when it is). A route file left out of this list would be appended unprotected;
 * `root-stack-routes.test.ts` fails when one is.
 */
export function RootStack() {
  const access = useRootRouteAccess();
  const { isConfigured } = useAuth();

  return (
    <Stack screenOptions={ROOT_STACK_SCREEN_OPTIONS}>
      {/* An unconfigured build still opens sign-in directly to show why it is disabled. */}
      <Stack.Protected guard={access === 'sign-in' || !isConfigured}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={access === 'sync-setup'}>
        <Stack.Screen name="sync-setup" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={access === 'app'}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Back' }} />
        <Stack.Screen name="exercise-history" />
        {/* Draws its own top bar (`Stack.Screen` options in the screen). */}
        <Stack.Screen name="completed-session/[sessionId]" />
        <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen
          name="connected-agents"
          options={{ title: 'Connected agents' }}
        />
        <Stack.Screen name="dev-logs" options={{ title: 'Logs' }} />
        <Stack.Screen name="exercise-link" options={{ title: 'Link exercise' }} />
        <Stack.Screen name="gyms" options={{ title: 'Gyms' }} />
        <Stack.Screen name="group/mine" options={{ title: 'My groups' }} />
        <Stack.Screen name="group/new" options={{ title: 'New group' }} />
        <Stack.Screen name="group/join" options={{ title: 'Join group' }} />
        {/* The group screen replaces this title with the group's name once loaded. */}
        <Stack.Screen name="group/[groupId]/index" options={{ title: 'Group' }} />
        <Stack.Screen name="group/[groupId]/edit" options={{ title: 'Edit group' }} />
        <Stack.Screen name="group/[groupId]/invite" options={{ title: 'Invite' }} />
        <Stack.Screen name="group/[groupId]/members" options={{ title: 'Members' }} />
        <Stack.Screen
          name="group/[groupId]/exercises/new"
          options={{ title: 'Add exercise' }}
        />
        <Stack.Screen
          name="group/[groupId]/exercises/[exerciseId]/edit"
          options={{ title: 'Edit exercise' }}
        />
        {/* The board replaces this title with the group exercise's name once loaded. */}
        <Stack.Screen
          name="group/[groupId]/leaderboards/[exerciseId]/index"
          options={{ title: 'Leaderboard' }}
        />
        <Stack.Screen
          name="group/[groupId]/leaderboards/[exerciseId]/history"
          options={{ title: 'History' }}
        />
        <Stack.Screen
          name="group-session/[memberId]/[sessionId]"
          options={{ title: 'Session' }}
        />
        {/* The session view and exercise page (steps 5 and 4 of the exercise/session
            redesign) draw their own top bars.
            Their titles are the back label of what they push (Gyms, Link exercise). */}
        <Stack.Screen
          name="session/[sessionId]/index"
          options={{ headerShown: false, title: 'Session' }}
        />
        <Stack.Screen
          name="session/[sessionId]/exercise/[sessionExerciseId]"
          options={{ headerShown: false, title: 'Exercise' }}
        />
      </Stack.Protected>
      {/* Dev/test only (self-gated). Reachable while first sync is pending too: it is
          what lifts the block in tests. Not while signed out. */}
      <Stack.Protected guard={access !== 'sign-in'}>
        <Stack.Screen name="maestro-harness" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
