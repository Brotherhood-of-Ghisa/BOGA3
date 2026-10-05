import { useLocalSearchParams } from 'expo-router';

import { SessionInsightPresentation } from '@/components/session-recorder/session-insight-presentation';
import { Screen, ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { useSessionLiveInsights } from '@/src/session-recorder/use-session-live-insights';
import { useSessionView } from '@/src/session-recorder/use-session-view';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Session vs history: the open session's volume by exercise and by muscle
 * against the user's earlier sessions. Reached from the session view's ⋮
 * (`SessionOptionsSheet`); it reads the same session as the view and reloads on
 * focus.
 */
export function SessionCompareScreen({ sessionId }: { sessionId: string | null }) {
  const { state, reload } = useSessionView(sessionId);
  const { insights, muscleCatalogState } = useSessionLiveInsights(sessionId, state);

  if (state.status === 'loading') {
    return (
      <Screen testID="session-compare-screen">
        <StatePanel kind="loading" testID="session-compare-loading" />
      </Screen>
    );
  }
  if (state.status !== 'ready' || !insights) {
    return (
      <Screen testID="session-compare-screen">
        {state.status === 'error' ? (
          <StatePanel
            action={{ label: 'Retry', onPress: () => void reload(), testID: 'session-compare-retry' }}
            kind="error"
            testID="session-compare-error"
            title="Couldn't load this session."
          />
        ) : (
          <StatePanel testID="session-compare-missing" title="This session is no longer active." />
        )}
      </Screen>
    );
  }
  return (
    <Screen testID="session-compare-screen">
      <ScreenScroll testID="session-compare-scroll">
        <SessionInsightPresentation
          exerciseComparisons={insights.exercise}
          historyState={state.data.insightHistoryState}
          muscleCatalogState={muscleCatalogState}
          muscleComparisons={insights.muscle}
        />
      </ScreenScroll>
    </Screen>
  );
}

export default function SessionCompareRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  return <SessionCompareScreen sessionId={firstParam(params.sessionId)} />;
}
