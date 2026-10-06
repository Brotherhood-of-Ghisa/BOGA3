import { useFocusEffect, useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, IconButton, ListRow, Notice, StatePanel, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { PlanCardChoiceSheet, type PlanCardChoice } from '@/components/session-planner/plan-card-choice-sheet';
import { sessionViewHref } from '@/src/navigation/active-session-entry';
import { findActiveSessionId } from '@/src/data/session-list';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import {
  addPlanBlockToSession,
  planQueries,
  planRepository,
  skipPlanBlock,
  startSessionPlan,
  type PlanBlockView,
  type PlanDetailView,
} from '@/src/session-planner';

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export type SessionPlanDetailScreenProps = {
  planId: string | null;
};

const PROVENANCE_LABEL: Record<PlanDetailView['provenance'], string | null> = {
  human: null,
  agent: 'Coached plan',
};

const formatSchedule = (at: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

const blockStateWord = (block: PlanBlockView): string => {
  if (block.status === 'completed') return 'Completed';
  if (block.status === 'skipped') return 'Skipped';
  if (block.status === 'attached') return 'In progress';
  return 'Ready';
};

const progressLine = (detail: PlanDetailView): string => {
  const counts = detail.blockCounts;
  const done = counts.completed + counts.skipped;
  const total = done + counts.pending + counts.attached;
  if (total === 0) return 'No blocks yet';
  return `${done} of ${total} blocks done`;
};

const blockTargetsLine = (block: PlanBlockView): string => {
  const parts = block.targets.map((target) => {
    const weight = target.targetWeightValue !== null ? `${target.targetWeightValue} kg` : '—';
    return `${weight} × ${target.targetReps}`;
  });
  return parts.join(' · ');
};

/**
 * One session plan: its targets, Start all, per-block Add to session,
 * Duplicate, and Delete while lifecycle permits. Consumed blocks are
 * read-only and link to their performed session; every state the user sees
 * is a typed result of the planner's domain calls.
 */
export function SessionPlanDetailScreen({ planId }: SessionPlanDetailScreenProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<PlanDetailView | null | 'loading'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ blockName: string; candidates: PlanCardChoice[]; planExerciseId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (planId === null) return;
    try {
      const loaded = await planQueries.loadPlanDetail(planId);
      setDetail(loaded);
    } catch {
      setDetail(null);
    }
  }, [planId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const startAll = () =>
    run(async () => {
      if (planId === null) return;
      setNotice(null);
      setResumeSessionId(null);
      const result = await startSessionPlan(planId);
      if (result.status === 'started' || result.status === 'already-active') {
        router.push(sessionViewHref(result.sessionId));
        return;
      }
      if (result.status === 'active-conflict') {
        // One Resume action; nothing is created and nothing is replaced.
        setResumeSessionId(result.activeSessionId);
        setNotice('Another session is active. Resume it to keep working.');
        return;
      }
      if (result.status === 'no-pending-blocks') {
        setNotice('Nothing left to start in this plan.');
        return;
      }
      setNotice("Couldn't start the plan. Try again.");
    });

  const addBlock = (block: PlanBlockView) =>
    run(async () => {
      setNotice(null);
      setResumeSessionId(null);
      const result = await addPlanBlockToSession(block.id);
      if (result.status === 'attached') {
        router.push(sessionViewHref(result.sessionId));
        return;
      }
      if (result.status === 'ambiguous') {
        await openCardChoice(block);
        return;
      }
      if (result.status === 'block-not-available' || result.status === 'block-not-found') {
        setNotice('That block is no longer available.');
        void reload();
        return;
      }
      setNotice("Couldn't add the block. Try again.");
    });

  // The typed result names the candidate cards only; their rows come from the
  // active session's own snapshot, where those cards live.
  const openCardChoice = async (block: PlanBlockView) => {
    const sessionId = await findActiveSessionId();
    if (sessionId === null) {
      setNotice("Couldn't add the block. Try again.");
      return;
    }
    const snapshot = await loadSessionSnapshotById(sessionId);
    const candidates = (snapshot?.exercises ?? [])
      .filter((card) => card.exerciseDefinitionId === block.exerciseDefinitionId)
      .map((card) => ({ id: card.id, exerciseName: card.name, setCount: card.sets.length }));
    if (candidates.length === 0) {
      setNotice("Couldn't add the block. Try again.");
      return;
    }
    setChoice({ blockName: block.name, candidates, planExerciseId: block.id });
  };

  const duplicate = () =>
    run(async () => {
      if (planId === null) return;
      router.push(`/session-plan/new?from=${encodeURIComponent(planId)}` as Href);
    });

  const edit = () => {
    if (planId === null) return;
    router.push(`/session-plan/new?edit=${encodeURIComponent(planId)}` as Href);
  };

  const confirmSkip = (block: PlanBlockView) => {
    Alert.alert(`Skip ${block.name}?`, 'The block moves on without recording any work.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Skip',
        style: 'default',
        onPress: () =>
          void run(async () => {
            setNotice(null);
            const result = await skipPlanBlock(block.id);
            if (result.status === 'skipped' || result.status === 'not-resolvable') {
              await reload();
              return;
            }
            setNotice("Couldn't skip the block. Try again.");
          }),
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert('Delete plan?', 'The plan and its unused blocks will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            if (planId === null) return;
            const result = await planRepository.deletePlan(planId);
            if (result.status === 'not-found' || result.status === 'updated' || result.status === 'saved') {
              router.back();
              return;
            }
            if (result.status === 'immutable-block') {
              setNotice('A used block pins this plan; it cannot be deleted.');
              return;
            }
            setNotice("Couldn't delete the plan. Try again.");
          }),
      },
    ]);
  };

  if (detail === 'loading') {
    return (
      <>
        <Stack.Screen options={{ title: 'Plan' }} />
        <StatePanel body="Loading the plan..." fill={false} kind="loading" testID="plan-detail-loading" />
      </>
    );
  }
  if (detail === null) {
    return (
      <>
        <Stack.Screen options={{ title: 'Plan' }} />
        <StatePanel
          body="This plan is no longer available."
          fill={false}
          testID="plan-detail-unavailable"
        />
      </>
    );
  }

  const deletable = detail.blockCounts.attached + detail.blockCounts.completed + detail.blockCounts.skipped === 0;

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
      <Card testID="plan-detail-summary">
        <View style={styles.summaryRow}>
          <View style={styles.summaryText}>
            <Text allowFontScaling={false} accessibilityRole="header" style={styles.title} testID="plan-detail-title">
              {detail.title}
            </Text>
            <Text allowFontScaling={false} style={styles.meta} testID="plan-detail-schedule">
              {detail.scheduledFor !== null ? `Scheduled ${formatSchedule(detail.scheduledFor)}` : 'Unscheduled'}
            </Text>
            <Text allowFontScaling={false} style={styles.meta} testID="plan-detail-progress">
              {progressLine(detail)}
            </Text>
            {PROVENANCE_LABEL[detail.provenance] ? (
              <Text allowFontScaling={false} style={styles.meta} testID="plan-detail-provenance">
                {PROVENANCE_LABEL[detail.provenance]}
              </Text>
            ) : null}
          </View>
          <IconButton
            accessibilityLabel="Edit this plan"
            name="pencil"
            onPress={edit}
            testID="plan-detail-edit"
          />
          <IconButton
            accessibilityLabel="Duplicate this plan"
            name="more-vertical"
            onPress={() => void duplicate()}
            testID="plan-detail-duplicate"
          />
        </View>
        <ActionButton
          accessibilityLabel="Start every available block of this plan"
          label="Start all"
          onPress={() => void startAll()}
          testID="plan-detail-start-all"
          variant="primary"
        />
        {deletable ? (
          <ActionButton
            accessibilityLabel="Delete this plan"
            label="Delete"
            onPress={confirmDelete}
            testID="plan-detail-delete"
            variant="outline"
          />
        ) : null}
      </Card>
      {detail.blocks.map((block, index) => (
        <Card key={block.id} testID={`plan-detail-block-${index + 1}`}>
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.blockTitle}>
            {block.name}
          </Text>
          <Text allowFontScaling={false} style={styles.meta} testID={`plan-detail-block-${index + 1}-state`}>
            {blockStateWord(block)} · Block {index + 1} of {detail.blocks.length}
          </Text>
          <Text allowFontScaling={false} style={styles.targets} testID={`plan-detail-block-${index + 1}-targets`}>
            {blockTargetsLine(block)}
          </Text>
          {block.status === 'pending' ? (
            <>
              <ListRow
                accessibilityLabel={`Add ${block.name} to the active session`}
                density="list"
                divider={false}
                label="Add to session"
                onPress={() => void addBlock(block)}
                testID={`plan-detail-block-${index + 1}-add`}
              />
              <ListRow
                accessibilityLabel={`Skip ${block.name} without doing it`}
                density="list"
                divider
                label="Skip without doing it"
                onPress={() => confirmSkip(block)}
                testID={`plan-detail-block-${index + 1}-skip`}
              />
            </>
          ) : block.attachedSessionId !== null ? (
            <ListRow
              accessibilityLabel="Open the session this block is part of"
              density="list"
              divider={false}
              label="Open session"
              onPress={() => router.push(sessionViewHref(block.attachedSessionId as string))}
              testID={`plan-detail-block-${index + 1}-session`}
            />
          ) : null}
        </Card>
      ))}

      <PlanCardChoiceSheet
        blockName={choice?.blockName ?? null}
        candidates={choice?.candidates ?? []}
        onConfirm={(cardId) => {
          const pending = choice;
          setChoice(null);
          if (!pending) return;
          void run(async () => {
            const result = await addPlanBlockToSession(pending.planExerciseId, cardId);
            if (result.status === 'attached') {
              router.push(sessionViewHref(result.sessionId));
              return;
            }
            setNotice("Couldn't add the block. Try again.");
          });
        }}
        onDismiss={() => setChoice(null)}
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
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.sm,
  },
  summaryText: {
    flex: 1,
    gap: uiSpace.xs,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  meta: {
    fontFamily: uiFonts.display.family,
    fontWeight: '400',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  blockTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  targets: {
    fontFamily: uiFonts.display.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});
