import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';
import {
  coerceMaestroHarnessQueryParam,
  isMaestroHarnessAllowed,
  resolveMaestroHarnessBootstrapAction,
  resolveMaestroHarnessFixtureName,
  resolveMaestroHarnessGateAction,
  resolveMaestroHarnessResetMode,
  resolveMaestroHarnessTeleportHref,
  resolveMaestroHarnessTeleportTarget,
  runMaestroHarnessBootstrapAction,
  runMaestroHarnessFixture,
  runMaestroHarnessGateAction,
  runMaestroHarnessReset,
} from '@/src/maestro/harness';

type HarnessStatus =
  | { kind: 'running'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function MaestroHarnessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    reset?: string | string[];
    fixture?: string | string[];
    bootstrap?: string | string[];
    gate?: string | string[];
    teleport?: string | string[];
    mode?: string | string[];
    intent?: string | string[];
    sessionId?: string | string[];
  }>();
  const [status, setStatus] = useState<HarnessStatus>({
    kind: 'running',
    message: 'Preparing Maestro harness action…',
  });
  // The harness runs its side effects (data reset, fixture seed, bootstrap-flag
  // flip) and its one teleport navigation exactly once per distinct harness URL.
  // The effect can re-run for reasons unrelated to the params (an ancestor
  // re-render, a router-identity change), and re-firing the teleport — an
  // imperative navigation issued from inside an effect — can drive a render loop.
  // Keying the guard on the param signature (not a bare boolean) keeps a fresh
  // harness link re-running while making a re-render for the SAME link a no-op,
  // so the screen can still be reused across successive openLinks in one flow.
  const lastRunKeyRef = useRef<string | null>(null);

  // `useLocalSearchParams` returns a fresh object on every render, so depending
  // on `params` directly re-runs this effect each time the component re-renders
  // (e.g. when the auth store notifies via `useSyncExternalStore`, or when we
  // call `setStatus`). For the `reset=data` path that means kicking off a brand
  // new `resetLocalAppData()` mid-flight. Derive stable primitive params and
  // depend on those so the harness action runs exactly once per harness URL.
  const resetParam = coerceMaestroHarnessQueryParam(params.reset);
  const fixtureParam = coerceMaestroHarnessQueryParam(params.fixture);
  const bootstrapParam = coerceMaestroHarnessQueryParam(params.bootstrap);
  const gateParam = coerceMaestroHarnessQueryParam(params.gate);
  const teleportParam = coerceMaestroHarnessQueryParam(params.teleport);
  const modeParam = coerceMaestroHarnessQueryParam(params.mode);
  const intentParam = coerceMaestroHarnessQueryParam(params.intent);
  const sessionIdParam = coerceMaestroHarnessQueryParam(params.sessionId);

  useEffect(() => {
    let cancelled = false;

    // Run the harness pipeline (and its single teleport) at most once per distinct
    // harness URL. A repeat effect pass for the SAME params is a no-op, so the
    // teleport cannot be re-issued in a loop; a NEW link (different params) still
    // runs, so the screen stays reusable across successive openLinks.
    const runKey = JSON.stringify([
      resetParam,
      fixtureParam,
      bootstrapParam,
      gateParam,
      teleportParam,
      modeParam,
      intentParam,
      sessionIdParam,
    ]);
    if (lastRunKeyRef.current === runKey) {
      return;
    }
    lastRunKeyRef.current = runKey;

    if (!isMaestroHarnessAllowed()) {
      setStatus({
        kind: 'error',
        message: 'Maestro harness is only available in development/test runtime contexts.',
      });
      return () => {
        cancelled = true;
      };
    }

    const resetMode = resolveMaestroHarnessResetMode(resetParam);
    const fixtureName = resolveMaestroHarnessFixtureName(fixtureParam);
    const bootstrapAction = resolveMaestroHarnessBootstrapAction(bootstrapParam);
    const gateAction = resolveMaestroHarnessGateAction(gateParam);
    const teleportTarget = resolveMaestroHarnessTeleportTarget(teleportParam);
    const teleportHref = resolveMaestroHarnessTeleportHref({
      target: teleportTarget,
      mode: modeParam,
      intent: intentParam,
      sessionId: sessionIdParam,
    });

    void (async () => {
      try {
        await runMaestroHarnessReset(resetMode);
        await runMaestroHarnessFixture(fixtureName);
        await runMaestroHarnessBootstrapAction(bootstrapAction);
        runMaestroHarnessGateAction(gateAction);

        if (cancelled) {
          return;
        }

        if (teleportTarget && !teleportHref) {
          setStatus({
            kind: 'error',
            message: `Unable to teleport to ${teleportTarget}. Required route parameters were missing.`,
          });
          return;
        }

        if (teleportHref) {
          setStatus({
            kind: 'success',
            message: `Maestro harness complete. Redirecting to ${teleportTarget}…`,
          });
          router.replace(teleportHref);
          return;
        }

        setStatus({
          kind: 'success',
          message: resetMode === 'data' ? 'Maestro data reset complete.' : 'Maestro harness ready.',
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Maestro harness action failed.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resetParam, fixtureParam, bootstrapParam, gateParam, teleportParam, modeParam, intentParam, sessionIdParam, router]);

  return (
    <View style={styles.screen} testID="maestro-harness-screen">
      {status.kind === 'running' ? <ActivityIndicator color={uiColors.actionPrimary} size="small" /> : null}
      <Text selectable style={[styles.message, status.kind === 'error' ? styles.errorMessage : null]} testID="maestro-harness-status">
        {status.message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
    backgroundColor: uiColors.surfacePage,
  },
  message: {
    color: uiColors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  errorMessage: {
    color: uiColors.actionDanger,
  },
});
