import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import { PlanCardChoiceSheet, type PlanCardChoice } from '@/components/session-planner/plan-card-choice-sheet';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import { addPlanBlockToSession } from '@/src/session-planner';
import { addExerciseToSession, appendPlanToSession } from '@/src/session-recorder/session-lifecycle';

const EXERCISE_CATALOG_MANAGE_ROUTE = '/exercise-catalog?source=session&intent=manage' as Href;

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export type AddExerciseScreenProps = {
  sessionId: string | null;
};

const BLOCK_NOTICE: Record<string, string> = {
  'block-not-found': "That planned block no longer exists.",
  'block-not-available': 'That planned block is no longer available.',
  'session-not-found': "Couldn't reach the active session. Try again.",
  'target-invalid': "That planned block can't join the selected card.",
};

/**
 * Add exercise: the session's exercise picker on its own route, presented as
 * an iOS page sheet (`presentation: 'modal'` in the root stack). Swiping down
 * or Close returns to the session with nothing added. A pick writes, then goes
 * back, and the session view reloads on focus; a failed write keeps the picker
 * open and says so. Manage pushes the catalogue, whose back returns here.
 *
 * A planner-block pick runs the same materialization the plan screens use
 * (`addPlanBlockToSession`); when several unsourced cards of the same exercise
 * could take it, the choice sheet asks which one — nothing is written until
 * it confirms.
 */
export function AddExerciseScreen({ sessionId }: AddExerciseScreenProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  // Planned blocks join the ACTIVE session only: adding one to a completed
  // session's history is meaningless, so the picker's From planner entry
  // stays hidden there.
  const [plannerEnabled, setPlannerEnabled] = useState(false);
  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    void loadSessionSnapshotById(sessionId).then((snapshot) => {
      if (cancelled) return;
      setPlannerEnabled(snapshot?.status === 'active');
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  const [choiceBlockName, setChoiceBlockName] = useState<string | null>(null);
  const [choiceCandidates, setChoiceCandidates] = useState<PlanCardChoice[]>([]);
  const [pendingPlanExerciseId, setPendingPlanExerciseId] = useState<string | null>(null);
  const writingRef = useRef(false);

  // One write at a time: a second pick while the first saves is ignored.
  const runWrite = async (write: (id: string) => Promise<unknown>) => {
    if (!sessionId || writingRef.current) return;
    writingRef.current = true;
    setNotice(null);
    try {
      await write(sessionId);
      router.back();
    } catch {
      setNotice("Couldn't add that exercise. Try again.");
    } finally {
      writingRef.current = false;
    }
  };

  const addPlanBlock = async (planExerciseId: string, targetSessionExerciseId?: string) => {
    if (writingRef.current) return;
    writingRef.current = true;
    setNotice(null);
    try {
      const result = await addPlanBlockToSession(planExerciseId, targetSessionExerciseId);
      if (result.status === 'attached') {
        router.back();
        return;
      }
      if (result.status === 'ambiguous') {
        setPendingPlanExerciseId(planExerciseId);
        await openCardChoice(result.candidateSessionExerciseIds);
        return;
      }
      setNotice(BLOCK_NOTICE[result.status] ?? "Couldn't add that planned block. Try again.");
    } catch {
      setNotice("Couldn't add that planned block. Try again.");
    } finally {
      writingRef.current = false;
    }
  };

  // The typed result names the candidate cards only; their rows are read from
  // this session's own snapshot, where the active session's cards live.
  const openCardChoice = async (candidateIds: string[]) => {
    if (!sessionId) {
      setNotice("Couldn't add that planned block. Try again.");
      return;
    }
    const snapshot = await loadSessionSnapshotById(sessionId);
    const candidates = candidateIds
      .map((id) => snapshot?.exercises.find((exercise) => exercise.id === id))
      .filter((card) => card !== undefined)
      .map((card) => ({
        id: card.id,
        exerciseName: card.name,
        setCount: card.sets.length,
      }));
    if (candidates.length === 0) {
      setNotice("Couldn't add that planned block. Try again.");
      return;
    }
    setChoiceCandidates(candidates);
    setChoiceBlockName(candidates[0].exerciseName);
  };

  return (
    <>
      <ExercisePicker
        notice={notice}
        plannerEnabled={plannerEnabled}
        onAddPlanBlock={(planExerciseId) => {
          void addPlanBlock(planExerciseId);
        }}
        onAppendPlan={(exercise, suggestion) => {
          void runWrite((id) => appendPlanToSession(id, exercise, suggestion));
        }}
        onClose={() => router.back()}
        onOpenManage={() => router.push(EXERCISE_CATALOG_MANAGE_ROUTE)}
        onSelectExercise={(exerciseDefinitionId, exerciseName) => {
          void runWrite((id) => addExerciseToSession(id, { id: exerciseDefinitionId, name: exerciseName }));
        }}
      />
      <PlanCardChoiceSheet
        blockName={choiceBlockName}
        candidates={choiceCandidates}
        onConfirm={(cardId) => {
          const planExerciseId = pendingPlanExerciseId;
          setPendingPlanExerciseId(null);
          if (planExerciseId === null) return;
          void addPlanBlock(planExerciseId, cardId);
        }}
        onDismiss={() => {
          setPendingPlanExerciseId(null);
          setChoiceBlockName(null);
          setChoiceCandidates([]);
        }}
      />
    </>
  );
}

export default function AddExerciseRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  return <AddExerciseScreen sessionId={coerceParam(params.sessionId)} />;
}
