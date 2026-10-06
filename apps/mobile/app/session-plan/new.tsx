import { useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';
import { useEffect, useState } from 'react';

import { PlanFormScreen, type SaveOutcome } from '@/components/session-planner/plan-form-screen';
import { StatePanel } from '@/components/ui';
import { ScreenScroll } from '@/components/ui/screen';
import { planRepository } from '@/src/session-planner';
import { savePlanEdits } from '@/src/session-planner/plan-edit-sync';
import { emptyPlanForm, planFormFromDetail, planFormToDraft, type PlanFormState } from '@/src/session-planner/plan-form-model';
import { planQueries } from '@/src/session-planner/plan-queries';

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export type SessionPlanNewScreenProps = {
  /** `from`: a plan to prefill the form from (duplicate); Save still creates. */
  fromPlanId: string | null;
  /** `edit`: a plan to edit in place; Save writes the guarded operations. */
  editPlanId: string | null;
};

/**
 * New session plan: the shared plan editor over an empty form. Opened with
 * `?from=<planId>` it prefills from that plan and saving creates a new plan —
 * a duplicate is a fresh authoring pass, never an in-place copy. Opened with
 * `?edit=<planId>` it edits that plan: the guarded per-operation sync, which
 * refuses (and writes nothing) when the diff would touch a consumed block.
 * Saving is local-first, so it works offline.
 */
export function SessionPlanNewScreen({ fromPlanId, editPlanId }: SessionPlanNewScreenProps) {
  const router = useRouter();
  const isEdit = editPlanId !== null;
  const prefillPlanId = fromPlanId ?? editPlanId;
  const [initialForm, setInitialForm] = useState<PlanFormState | 'loading' | 'unavailable'>(
    prefillPlanId === null ? emptyPlanForm() : 'loading'
  );

  useEffect(() => {
    if (prefillPlanId === null) return;
    let cancelled = false;
    planQueries.loadPlanDetail(prefillPlanId).then((detail) => {
      if (cancelled) return;
      setInitialForm(detail !== null ? planFormFromDetail(detail) : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [prefillPlanId]);

  const onSave = async (form: PlanFormState): Promise<SaveOutcome> => {
    if (isEdit && editPlanId !== null) {
      const result = await savePlanEdits(editPlanId, form);
      if (result.status === 'updated') {
        router.back();
        return { status: 'saved', planId: editPlanId };
      }
      return {
        status: 'failed',
        message:
          result.status === 'immutable-block'
            ? 'A block that is in progress or already done is read-only; it cannot be changed here.'
            : result.status === 'validation-failed'
              ? result.errors[0]?.message ?? "Couldn't save the plan. Try again."
              : "Couldn't save the plan. Try again.",
      };
    }
    const prepared = planFormToDraft(form);
    if (prepared.draft === null) {
      return { status: 'failed', message: prepared.scheduleError };
    }
    const result = await planRepository.createPlan(prepared.draft);
    if (result.status === 'saved') {
      router.replace(`/session-plan/${encodeURIComponent(result.id)}` as Href);
      return { status: 'saved', planId: result.id };
    }
    return {
      status: 'failed',
      message:
        result.status === 'validation-failed'
          ? result.errors[0]?.message ?? "Couldn't save the plan. Try again."
          : "Couldn't save the plan. Try again.",
    };
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="plan-form-scroll">
      {/* The route's own title: the loaded plan's when editing. */}
      <Stack.Screen
        options={{ title: isEdit && initialForm !== 'loading' && initialForm !== 'unavailable' ? initialForm.title : 'New session plan' }}
      />
      {initialForm === 'loading' ? (
        <StatePanel body="Loading the plan..." fill={false} kind="loading" testID="plan-form-loading" />
      ) : initialForm === 'unavailable' ? (
        <StatePanel
          body="The plan is no longer available."
          fill={false}
          testID="plan-form-unavailable"
        />
      ) : (
        <PlanFormScreen initialForm={initialForm} onSave={onSave} saveLabel={isEdit ? 'Save changes' : 'Save plan'} />
      )}
    </ScreenScroll>
  );
}

export default function SessionPlanNewRoute() {
  const params = useLocalSearchParams<{ from?: string | string[]; edit?: string | string[] }>();
  return <SessionPlanNewScreen editPlanId={coerceParam(params.edit)} fromPlanId={coerceParam(params.from)} />;
}
