import { useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';

import { Notice, StatePanel } from '@/components/ui';
import { ScreenScroll } from '@/components/ui/screen';
import { NextProgrammeBlockCard } from '@/components/session-planner/next-programme-block-card';
import { PlanCardChoiceSheet } from '@/components/session-planner/plan-card-choice-sheet';
import { ProgrammeDetailHeader } from '@/components/session-planner/programme-detail-header';
import { ProgrammePlanList } from '@/components/session-planner/programme-plan-list';
import { useProgrammeDetail } from '@/components/session-planner/use-programme-detail';

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export type ProgrammeDetailScreenProps = {
  programmeId: string | null;
};

/**
 * Programme detail route: displays programme progress, child sessions,
 * and the deterministic next unresolved block in sequence.
 * Allows adding the next block to an active session, skipping it,
 * reordering future sessions, and contract-defined deletion (which
 * detaches child plans as standalone plans).
 */
export function ProgrammeDetailScreen({ programmeId }: ProgrammeDetailScreenProps) {
  const router = useRouter();
  const controller = useProgrammeDetail(programmeId);
  const { detail, notice, choice } = controller;

  if (detail === 'loading' || detail === null) {
    const unavailable = detail === null;
    return (
      <ScreenScroll testID="programme-detail-scroll">
        <Stack.Screen options={{ title: 'Programme' }} />
        <StatePanel
          body={unavailable ? 'This programme is no longer available.' : 'Loading the programme...'}
          fill={false}
          kind={unavailable ? undefined : 'loading'}
          testID={unavailable ? 'programme-detail-unavailable' : 'programme-detail-loading'}
        />
      </ScreenScroll>
    );
  }

  const openPlanDetail = (planId: string) => {
    router.push(`/session-plan/${encodeURIComponent(planId)}` as Href);
  };

  return (
    <>
      <Stack.Screen options={{ title: detail.name }} />
      <ScreenScroll testID="programme-detail">
        {notice ? (
          <Notice
            message={notice}
            testID="programme-detail-notice"
            tone="danger"
          />
        ) : null}

        <ProgrammeDetailHeader
          detail={detail}
          onDelete={controller.confirmDelete}
          onDuplicate={controller.duplicate}
          onEdit={controller.edit}
        />

        <NextProgrammeBlockCard
          nextBlock={detail.nextBlock}
          onAdd={controller.addBlock}
          onSkip={controller.skipBlock}
        />

        <ProgrammePlanList
          onOpenPlan={openPlanDetail}
          onReorderPlans={controller.reorderPlans}
          plans={detail.plans}
        />

        <PlanCardChoiceSheet
          blockName={choice?.blockName ?? null}
          candidates={choice?.candidates ?? []}
          onConfirm={controller.attachToChosenCard}
          onDismiss={() => controller.setChoice(null)}
        />
      </ScreenScroll>
    </>
  );
}

export default function ProgrammeDetailRoute() {
  const params = useLocalSearchParams<{ programmeId?: string | string[] }>();
  return <ProgrammeDetailScreen programmeId={coerceParam(params.programmeId)} />;
}
