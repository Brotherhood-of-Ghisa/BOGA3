import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import type { PlanCardChoice } from '@/components/session-planner/plan-card-choice-sheet';
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

export type PlanDetailController = {
  detail: PlanDetailView | null | 'loading';
  notice: string | null;
  resumeSessionId: string | null;
  choice: { blockName: string; candidates: PlanCardChoice[]; planExerciseId: string } | null;
  startAll: () => void;
  addBlock: (block: PlanBlockView) => void;
  skipBlock: (block: PlanBlockView) => void;
  confirmDelete: () => void;
  edit: () => void;
  duplicate: () => void;
  attachToChosenCard: (cardId: string) => void;
  setChoice: (choice: PlanDetailController['choice']) => void;
};

/**
 * The plan detail's state and actions: the plan read (on focus), and every
 * write composed from the planner's typed results — Start all (an
 * active-session conflict offers one Resume), per-block Add to session (the
 * ambiguous card choice loads from the active session's snapshot and writes
 * nothing until confirmed), Skip, and confirmed Delete while lifecycle
 * permits. The route renders what this returns; the domain owns the writes.
 */
export const usePlanDetail = (planId: string | null): PlanDetailController => {
  const router = useRouter();
  const [detail, setDetail] = useState<PlanDetailView | null | 'loading'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [choice, setChoice] = useState<PlanDetailController['choice']>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (planId === null) return;
    try {
      setDetail(await planQueries.loadPlanDetail(planId));
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

  const clearNotice = () => {
    setNotice(null);
    setResumeSessionId(null);
  };

  // The typed result names the candidate cards only; their rows come from the
  // active session's own snapshot, where those cards live.
  const openCardChoice = async (block: PlanBlockView) => {
    const sessionId = await findActiveSessionId();
    if (sessionId === null) {
      setNotice("Couldn't add the block. Try again.");
      return;
    }
    const snapshot = await loadSessionSnapshotById(sessionId);
    // The domain's compatible card is an UNSOURCED card of the same
    // definition: a card already sourced from another block must never be
    // offered, or the confirm dead-ends in `target-invalid`.
    const candidates = (snapshot?.exercises ?? [])
      .filter(
        (card) =>
          card.exerciseDefinitionId === block.exerciseDefinitionId &&
          (card.sourcePlanExerciseId ?? null) === null,
      )
      .map((card) => ({ id: card.id, exerciseName: card.name, setCount: card.sets.length }));
    if (candidates.length === 0) {
      setNotice("Couldn't add the block. Try again.");
      return;
    }
    setChoice({ blockName: block.name, candidates, planExerciseId: block.id });
  };

  const startAll = () =>
    run(async () => {
      if (planId === null) return;
      clearNotice();
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
      clearNotice();
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

  const skipBlock = (block: PlanBlockView) =>
    run(async () => {
      clearNotice();
      const result = await skipPlanBlock(block.id);
      if (result.status === 'skipped') {
        await reload();
        return;
      }
      if (result.status === 'not-resolvable') {
        // Confirmed source-derived work exists: skip never claims or discards
        // done work — complete the block instead.
        setNotice('This block has confirmed work. Complete it instead of skipping.');
        return;
      }
      setNotice("Couldn't skip the block. Try again.");
    });

  const attachToChosenCard = (cardId: string) => {
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

  return {
    detail,
    notice,
    resumeSessionId,
    choice,
    startAll: () => void startAll(),
    addBlock: (block) => void addBlock(block),
    skipBlock: (block) => void skipBlock(block),
    confirmDelete,
    edit,
    duplicate: () => void duplicate(),
    attachToChosenCard,
    setChoice,
  };
};
