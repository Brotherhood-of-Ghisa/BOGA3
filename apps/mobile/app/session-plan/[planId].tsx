import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { ActionButton, Card, ListRow, Notice, Sheet, StatePanel, uiSpace } from '@/components/ui';
import { ScreenScroll } from '@/components/ui/screen';
import { PlanCardChoiceSheet } from '@/components/session-planner/plan-card-choice-sheet';
import { PlanDetailBlocks } from '@/components/session-planner/plan-detail-blocks';
import { PlanDetailSummary } from '@/components/session-planner/plan-detail-summary';
import { usePlanDetail } from '@/components/session-planner/use-plan-detail';
import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';
import { sessionViewHref } from '@/src/navigation/active-session-entry';
import { useDateFormat } from '@/src/preferences/hooks';
import { routineOutcomeLine } from '@/components/session-planner/progress-labels';
import type { PlanDetailController } from '@/components/session-planner/use-plan-detail';
import type { PlanDetailView } from '@/src/session-planner';

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export type SessionPlanDetailScreenProps = {
  planId: string | null;
};

/**
 * One session plan: its targets, progress and provenance, with the plan's
 * actions — Start all, per-block Add to session, Skip, Duplicate, Edit and
 * confirmed Delete while lifecycle permits. Consumed blocks are read-only
 * and link to their performed session. State and writes live in
 * `usePlanDetail`; this route renders what it returns.
 */
export function SessionPlanDetailScreen({ planId }: SessionPlanDetailScreenProps) {
  const router = useRouter();
  const openActiveWorkout = useOpenActiveWorkout();
  const controller = usePlanDetail(planId);
  const { detail, notice, resumeSessionId, choice } = controller;

  // One in-route state panel covers both early states: the first load and a
  // missing or deleted plan (a bad param never crashes nor redirects).
  if (detail === 'loading' || detail === null) {
    const unavailable = detail === null;
    return (
      <ScreenScroll testID="plan-detail-scroll">
        <Stack.Screen options={{ title: 'Plan' }} />
        <StatePanel
          action={controller.loadError ? { label: 'Retry', onPress: () => void controller.reload(), testID: 'plan-detail-retry' } : undefined}
          body={controller.loadError ?? (unavailable ? 'This plan is no longer available.' : 'Loading the plan...')}
          fill={false}
          kind={controller.loadError ? 'error' : unavailable ? undefined : 'loading'}
          testID={controller.loadError ? 'plan-detail-error' : unavailable ? 'plan-detail-unavailable' : 'plan-detail-loading'}
        />
      </ScreenScroll>
    );
  }

  const deletable =
    !detail.routine?.hasKnownUse && detail.blockCounts.attached + detail.blockCounts.completed + detail.blockCounts.skipped === 0;

  const noticeView = notice ? <Notice
    action={resumeSessionId !== null ? <ActionButton
      accessibilityLabel="Resume the active session" label="Resume"
      onPress={() => openActiveWorkout(resumeSessionId)} testID="plan-detail-resume" variant="outline"
    /> : undefined}
    message={notice} testID="plan-detail-notice" tone={resumeSessionId !== null ? 'neutral' : 'danger'}
  /> : null;

  return (
    <>
      {/* The data-dependent title convention: the plan's title once it loads. */}
      <Stack.Screen options={{ title: detail.title }} />
      <ScreenScroll testID="plan-detail">
        {controller.loadError ? <StatePanel action={{ label: 'Retry', onPress: () => void controller.reload(), testID: 'plan-detail-retry' }}
          body={controller.loadError} fill={false} kind="error" testID="plan-detail-error" /> : null}
        {!detail.isRoutine ? noticeView : null}
        <PlanDetailSummary
          busy={controller.busy}
          deletable={deletable}
          detail={detail}
          onDelete={controller.confirmDelete}
          onDuplicate={controller.duplicate}
          onEdit={controller.edit}
          onStartAll={controller.startAll}
          onSkipRoutine={controller.openRoutineSkip}
          notice={detail.isRoutine ? noticeView : null}
        />
        <PlanDetailBlocks
          detail={detail}
          onAdd={controller.addBlock}
          onOpenSession={(sessionId, attached) => (attached ? openActiveWorkout(sessionId) : router.push(sessionViewHref(sessionId)))}
          onSkip={controller.skipBlock}
        />

        <PlanCardChoiceSheet
          blockName={choice?.blockName ?? null}
          candidates={choice?.candidates ?? []}
          onConfirm={controller.attachToChosenCard}
          onDismiss={() => controller.setChoice(null)}
        />
        <RoutineSkipConfirmation controller={controller} detail={detail} />
      </ScreenScroll>
    </>
  );
}

function RoutineSkipConfirmation({ controller, detail }: { controller: PlanDetailController; detail: PlanDetailView }) {
  const dateFormat = useDateFormat();
  return <Sheet dismissLabel="Dismiss skip confirmation" onDismiss={controller.dismissRoutineSkip}
    testID="plan-detail-skip-sheet" title="Skip this use?" visible={controller.skipOpen}>
    <View style={styles.skipBody}>
      <Card><ListRow density="list" label={detail.title}
        description={detail.routine ? routineOutcomeLine(detail.routine, dateFormat) : undefined} /></Card>
      {controller.skipError ? <Notice message={controller.skipError} testID="plan-detail-skip-error" tone="danger" /> : null}
      <ActionButton disabled={controller.skipBusy} label="Skip this use" onPress={controller.confirmRoutineSkip}
        testID="plan-detail-skip-confirm" variant="primary" />
    </View>
  </Sheet>;
}

export default function SessionPlanDetailRoute() {
  const params = useLocalSearchParams<{ planId?: string | string[] }>();
  return <SessionPlanDetailScreen planId={coerceParam(params.planId)} />;
}

const styles = StyleSheet.create({
  skipBody: { paddingHorizontal: uiSpace.lg, gap: uiSpace.md },
});
