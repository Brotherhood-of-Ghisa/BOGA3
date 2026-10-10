import { useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';
import { useEffect, useState } from 'react';

import { ProgrammeFormScreen } from '@/components/session-planner/programme-form-screen';
import type { SaveOutcome } from '@/components/session-planner/plan-form-screen';
import { StatePanel } from '@/components/ui';
import { ScreenScroll } from '@/components/ui/screen';
import {
  emptyProgrammeForm,
  planQueries,
  planRepository,
  programmeFormFromDetail,
  programmeFormToDraft,
  saveProgrammeEdits,
  type PlanMutationResult,
  type ProgrammeFormState,
} from '@/src/session-planner';
import { ensureExerciseCatalogLoaded, getExerciseCatalogSnapshot, useExerciseCatalog } from '@/src/exercise-catalog/cache';

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

const programmeEditErrorMessage = (result: PlanMutationResult): string => {
  switch (result.status) {
    case 'validation-failed':
      return result.errors[0]?.message ?? "Couldn't save changes. Try again.";
    case 'immutable-block':
      return 'A block in this programme has already been used, so those changes can’t be saved.';
    case 'limit-exceeded':
      return 'This programme has reached its session limit.';
    case 'invalid-order':
      return "Couldn't save the new session order. Try again.";
    default:
      return "Couldn't save changes. Try again.";
  }
};

export type ProgrammeNewScreenProps = {
  /** `from`: a programme to prefill the form from (duplicate); Save still creates. */
  fromProgrammeId: string | null;
  /** `edit`: a programme to edit in place; Save updates metadata and order. */
  editProgrammeId: string | null;
};

/**
 * New training programme route: authoring multi-session programmes.
 * Opened with `?from=<programmeId>` it prefills from that programme and saving creates
 * a new programme. Opened with `?edit=<programmeId>` it updates the programme metadata
 * and reorders its child sessions.
 */
export function ProgrammeNewScreen({ fromProgrammeId, editProgrammeId }: ProgrammeNewScreenProps) {
  const router = useRouter();
  const catalog = useExerciseCatalog();
  const isEdit = editProgrammeId !== null;
  const prefillProgrammeId = fromProgrammeId ?? editProgrammeId;
  const [initialForm, setInitialForm] = useState<ProgrammeFormState | 'loading' | 'unavailable'>(
    prefillProgrammeId === null ? emptyProgrammeForm() : 'loading'
  );

  useEffect(() => {
    if (prefillProgrammeId === null) return;
    let cancelled = false;
    void Promise.all([
      planQueries.loadProgrammeDetail(prefillProgrammeId),
      ensureExerciseCatalogLoaded().then(() => getExerciseCatalogSnapshot().exercises).catch(() => []),
    ]).then(([detail, loadedExercises]) => {
      if (cancelled) return;
      const exercises = loadedExercises.length > 0 ? loadedExercises : catalog.exercises;
      setInitialForm(detail !== null ? programmeFormFromDetail(detail, exercises) : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [prefillProgrammeId, catalog.exercises]);

  const onSave = async (form: ProgrammeFormState): Promise<SaveOutcome> => {
    if (isEdit && editProgrammeId !== null) {
      const result = await saveProgrammeEdits(editProgrammeId, form);
      if (result.status === 'saved' || result.status === 'updated') {
        router.back();
        return { status: 'saved', planId: editProgrammeId };
      }
      return { status: 'failed', message: programmeEditErrorMessage(result) };
    }

    const prepared = programmeFormToDraft(form);
    if (prepared.draft === null) {
      return { status: 'failed', message: prepared.errors[0]?.message ?? 'Please check all session dates.' };
    }

    const result = await planRepository.createProgramme(prepared.draft);
    if (result.status === 'saved') {
      router.replace(`/programme/${encodeURIComponent(result.id)}` as Href);
      return { status: 'saved', planId: result.id };
    }

    return {
      status: 'failed',
      message:
        result.status === 'validation-failed'
          ? result.errors[0]?.message ?? "Couldn't save the programme. Try again."
          : "Couldn't save the programme. Try again.",
    };
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="programme-form-scroll">
      <Stack.Screen
        options={{
          title:
            isEdit && initialForm !== 'loading' && initialForm !== 'unavailable'
              ? initialForm.name || 'Edit programme'
              : 'New programme',
        }}
      />
      {initialForm === 'loading' ? (
        <StatePanel body="Loading the programme..." fill={false} kind="loading" testID="programme-form-loading" />
      ) : initialForm === 'unavailable' ? (
        <StatePanel
          body="The programme is no longer available."
          fill={false}
          testID="programme-form-unavailable"
        />
      ) : (
        <ProgrammeFormScreen
          initialForm={initialForm}
          onSave={onSave}
          saveLabel={isEdit ? 'Save changes' : 'Save programme'}
        />
      )}
    </ScreenScroll>
  );
}

export default function ProgrammeNewRoute() {
  const params = useLocalSearchParams<{ from?: string | string[]; edit?: string | string[] }>();
  return (
    <ProgrammeNewScreen
      editProgrammeId={coerceParam(params.edit)}
      fromProgrammeId={coerceParam(params.from)}
    />
  );
}
