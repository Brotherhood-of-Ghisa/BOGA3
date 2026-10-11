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
  type PlanBlockView,
  type ProgrammeDetailView,
} from '@/src/session-planner';

export type ProgrammeDetailController = {
  detail: ProgrammeDetailView | null | 'loading';
  notice: string | null;
  choice: { blockName: string; candidates: PlanCardChoice[]; planExerciseId: string } | null;
  addBlock: (block: PlanBlockView) => void;
  skipBlock: (block: PlanBlockView) => void;
  confirmDelete: () => void;
  edit: () => void;
  duplicate: () => void;
  reorderPlans: (orderedPlanIds: string[]) => void;
  attachToChosenCard: (cardId: string) => void;
  setChoice: (choice: ProgrammeDetailController['choice']) => void;
  reload: () => Promise<void>;
};

/**
 * Controller hook for the Programme Detail screen.
 * Handles reading programme detail, adding the next unresolved block
 * to an active or new session, explicit skip, reordering child plans,
 * and contract-defined deletion (which detaches child plans).
 */
export const useProgrammeDetail = (programmeId: string | null): ProgrammeDetailController => {
  const router = useRouter();
  const [detail, setDetail] = useState<ProgrammeDetailView | null | 'loading'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [choice, setChoice] = useState<ProgrammeDetailController['choice']>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (programmeId === null) return;
    try {
      setDetail(await planQueries.loadProgrammeDetail(programmeId));
    } catch {
      setDetail(null);
    }
  }, [programmeId]);

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
  };

  const openCardChoice = async (block: PlanBlockView) => {
    const sessionId = await findActiveSessionId();
    if (sessionId === null) {
      setNotice("Couldn't add the block. Try again.");
      return;
    }
    const snapshot = await loadSessionSnapshotById(sessionId);
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

  const addBlock = (block: PlanBlockView) => {
    void run(async () => {
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
      setNotice(
        result.status === 'block-not-available'
          ? 'This block is already attached or done.'
          : "Couldn't add the block. Try again.",
      );
    });
  };

  const attachToChosenCard = (cardId: string) => {
    if (choice === null) return;
    const planExerciseId = choice.planExerciseId;
    void run(async () => {
      clearNotice();
      setChoice(null);
      const result = await addPlanBlockToSession(planExerciseId, cardId);
      if (result.status === 'attached') {
        router.push(sessionViewHref(result.sessionId));
        return;
      }
      setNotice("Couldn't add the block. Try again.");
    });
  };

  const skipBlock = (block: PlanBlockView) => {
    void run(async () => {
      clearNotice();
      const result = await skipPlanBlock(block.id);
      if (result.status === 'skipped') {
        await reload();
        return;
      }
      setNotice(
        result.status === 'not-resolvable'
          ? 'This block is already attached or resolved.'
          : "Couldn't skip the block. Try again.",
      );
    });
  };

  const edit = () => {
    if (programmeId === null) return;
    router.push(`/programme/new?edit=${encodeURIComponent(programmeId)}` as Href);
  };

  const duplicate = () => {
    if (programmeId === null) return;
    router.push(`/programme/new?from=${encodeURIComponent(programmeId)}` as Href);
  };

  const reorderPlans = (orderedPlanIds: string[]) => {
    if (programmeId === null) return;
    void run(async () => {
      clearNotice();
      const result = await planRepository.reorderProgrammePlans(programmeId, orderedPlanIds);
      if (result.status === 'updated') {
        await reload();
        return;
      }
      setNotice("Couldn't reorder sessions. Try again.");
    });
  };

  const confirmDelete = () => {
    if (programmeId === null) return;
    Alert.alert(
      'Delete programme',
      'Child sessions will remain as standalone plans. Performed workouts are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete programme',
          style: 'destructive',
          onPress: () => {
            void run(async () => {
              const result = await planRepository.deleteProgramme(programmeId);
              if (result.status === 'updated') {
                router.back();
                return;
              }
              setNotice("Couldn't delete the programme. Try again.");
            });
          },
        },
      ],
    );
  };

  return {
    detail,
    notice,
    choice,
    addBlock,
    skipBlock,
    confirmDelete,
    edit,
    duplicate,
    reorderPlans,
    attachToChosenCard,
    setChoice,
    reload,
  };
};
