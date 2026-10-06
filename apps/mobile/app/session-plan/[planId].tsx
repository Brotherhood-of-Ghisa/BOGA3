import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ActionButton, Notice, StatePanel, uiSpace } from '@/components/ui';
import { PlanCardChoiceSheet } from '@/components/session-planner/plan-card-choice-sheet';
import { PlanDetailBlocks } from '@/components/session-planner/plan-detail-blocks';
import { PlanDetailSummary } from '@/components/session-planner/plan-detail-summary';
import { usePlanDetail } from '@/components/session-planner/use-plan-detail';
import { sessionViewHref } from '@/src/navigation/active-session-entry';

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
  const controller = usePlanDetail(planId);
  const { detail, notice, resumeSessionId, choice } = controller;

  // One in-route state panel covers both early states: the first load and a
  // missing or deleted plan (a bad param never crashes nor redirects).
  if (detail === 'loading' || detail === null) {
    const unavailable = detail === null;
    return (
      <>
        <Stack.Screen options={{ title: 'Plan' }} />
        <StatePanel
          body={unavailable ? 'This plan is no longer available.' : 'Loading the plan...'}
          fill={false}
          kind={unavailable ? undefined : 'loading'}
          testID={unavailable ? 'plan-detail-unavailable' : 'plan-detail-loading'}
        />
      </>
    );
  }

  const deletable =
    detail.blockCounts.attached + detail.blockCounts.completed + detail.blockCounts.skipped === 0;

  return (
    <>
      {/* The data-dependent title convention: the plan's title once it loads. */}
      <Stack.Screen options={{ title: detail.title }} />
      <View style={styles.screen} testID="plan-detail">
        {notice ? (
          <Notice
            action={
              resumeSessionId !== null ? (
                <ActionButton
                  accessibilityLabel="Resume the active session"
                  label="Resume"
                  onPress={() => router.push(sessionViewHref(resumeSessionId))}
                  testID="plan-detail-resume"
                  variant="outline"
                />
              ) : undefined
            }
            message={notice}
            testID="plan-detail-notice"
            tone={resumeSessionId !== null ? 'neutral' : 'danger'}
          />
        ) : null}
        <PlanDetailSummary
          deletable={deletable}
          detail={detail}
          onDelete={controller.confirmDelete}
          onDuplicate={controller.duplicate}
          onEdit={controller.edit}
          onStartAll={controller.startAll}
        />
        <PlanDetailBlocks
          detail={detail}
          onAdd={controller.addBlock}
          onOpenSession={(sessionId) => router.push(sessionViewHref(sessionId))}
          onSkip={controller.skipBlock}
        />

        <PlanCardChoiceSheet
          blockName={choice?.blockName ?? null}
          candidates={choice?.candidates ?? []}
          onConfirm={controller.attachToChosenCard}
          onDismiss={() => controller.setChoice(null)}
        />
      </View>
    </>
  );
}

export default function SessionPlanDetailRoute() {
  const params = useLocalSearchParams<{ planId?: string | string[] }>();
  return <SessionPlanDetailScreen planId={coerceParam(params.planId)} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: uiSpace.md,
    padding: uiSpace.lg,
  },
});
