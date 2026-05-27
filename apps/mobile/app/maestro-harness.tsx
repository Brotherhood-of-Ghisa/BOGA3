import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';
import {
  coerceMaestroHarnessQueryParam,
  isMaestroHarnessAllowed,
  resolveMaestroHarnessFixtureName,
  resolveMaestroHarnessResetMode,
  resolveMaestroHarnessTeleportHref,
  resolveMaestroHarnessTeleportTarget,
  runMaestroHarnessFixture,
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
    teleport?: string | string[];
    mode?: string | string[];
    intent?: string | string[];
    sessionId?: string | string[];
  }>();
  const [status, setStatus] = useState<HarnessStatus>({
    kind: 'running',
    message: 'Preparing Maestro harness action…',
  });

  useEffect(() => {
    let cancelled = false;

    if (!isMaestroHarnessAllowed()) {
      setStatus({
        kind: 'error',
        message: 'Maestro harness is only available in development/test runtime contexts.',
      });
      return () => {
        cancelled = true;
      };
    }

    const resetMode = resolveMaestroHarnessResetMode(coerceMaestroHarnessQueryParam(params.reset));
    const fixtureName = resolveMaestroHarnessFixtureName(coerceMaestroHarnessQueryParam(params.fixture));
    const teleportTarget = resolveMaestroHarnessTeleportTarget(coerceMaestroHarnessQueryParam(params.teleport));
    const teleportHref = resolveMaestroHarnessTeleportHref({
      target: teleportTarget,
      mode: coerceMaestroHarnessQueryParam(params.mode),
      intent: coerceMaestroHarnessQueryParam(params.intent),
      sessionId: coerceMaestroHarnessQueryParam(params.sessionId),
    });

    void (async () => {
      try {
        await runMaestroHarnessReset(resetMode);
        await runMaestroHarnessFixture(fixtureName);

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
  }, [params, router]);

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
