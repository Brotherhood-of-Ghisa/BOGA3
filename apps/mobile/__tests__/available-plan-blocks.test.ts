// The picker's "From planner" read model (`src/session-planner/available-blocks.ts`):
// which authored blocks an active session can still consume. Pins the
// offerable predicate, the programme title and block-count columns, and the
// de-duplication of a block reachable both as a standalone plan and through a
// programme — the behaviour a reader of the list depends on.

import { listAvailablePlanBlocks } from '@/src/session-planner/available-blocks';
import type { PlanBlockView, PlanDetailView, ProgrammeDetailView } from '@/src/session-planner/plan-queries';

jest.mock('@/src/session-planner/plan-queries', () => ({
  planQueries: {
    listUpcomingPlans: jest.fn(),
    listUnscheduledPlans: jest.fn(),
    listProgrammeSummaries: jest.fn(),
    loadPlanDetail: jest.fn(),
    loadProgrammeDetail: jest.fn(),
  },
}));

const { planQueries } = jest.requireMock<{ planQueries: Record<string, jest.Mock> }>(
  '@/src/session-planner/plan-queries',
);
const {
  listUpcomingPlans, listUnscheduledPlans, listProgrammeSummaries, loadPlanDetail, loadProgrammeDetail,
} = planQueries;

const block = (overrides: Partial<PlanBlockView> = {}): PlanBlockView => ({
  id: 'block-1',
  planId: 'plan-1',
  exerciseDefinitionId: 'def-1',
  name: 'Barbell Bench Press',
  orderIndex: 0,
  progressStatus: 'pending',
  status: 'pending',
  resolvedAt: null,
  attachedSessionId: null,
  attachedSessionExerciseId: null,
  targets: [{ id: 'target-1' }] as PlanBlockView['targets'],
  ...overrides,
});

const plan = (id: string, title: string, blocks: PlanBlockView[]): PlanDetailView =>
  ({ id, title, blocks } as PlanDetailView);

const programme = (id: string, name: string, plans: PlanDetailView[]): ProgrammeDetailView =>
  ({ id, name, plans } as ProgrammeDetailView);

/** `loadPlanDetail` / `loadProgrammeDetail` resolve by id from these maps. */
const seed = ({ plans = [], programmes = [] }: { plans?: PlanDetailView[]; programmes?: ProgrammeDetailView[] }) => {
  listUpcomingPlans.mockResolvedValue(plans.map((p) => ({ id: p.id })));
  listUnscheduledPlans.mockResolvedValue([]);
  listProgrammeSummaries.mockResolvedValue(programmes.map((p) => ({ id: p.id })));
  loadPlanDetail.mockImplementation(async (id: string) => plans.find((p) => p.id === id) ?? null);
  loadProgrammeDetail.mockImplementation(async (id: string) => programmes.find((p) => p.id === id) ?? null);
};

beforeEach(() => jest.clearAllMocks());

it('offers a pending block with an owned definition and a target', async () => {
  seed({ plans: [plan('plan-1', 'Push day', [block()])] });

  expect(await listAvailablePlanBlocks()).toEqual([
    { planId: 'plan-1', planTitle: 'Push day', planBlockCount: 1, block: block() },
  ]);
});

it.each([
  ['a non-pending block', block({ status: 'completed' })],
  ['a block without an owned definition', block({ exerciseDefinitionId: null })],
  ['a block without a target', block({ targets: [] })],
])('leaves out %s', async (_label, unofferable) => {
  seed({ plans: [plan('plan-1', 'Push day', [unofferable])] });

  expect(await listAvailablePlanBlocks()).toEqual([]);
});

it('counts the planblocks it came from, not the offerable ones', async () => {
  seed({
    plans: [plan('plan-1', 'Push day', [block(), block({ id: 'block-2', targets: [] })])],
  });

  const rows = await listAvailablePlanBlocks();
  expect(rows).toHaveLength(1);
  expect(rows[0].planBlockCount).toBe(2);
});

it('titles a programme block by programme and child plan', async () => {
  seed({
    programmes: [
      programme('prog-1', 'Strength', [plan('plan-9', 'Week 1 · Lower', [block({ id: 'block-9', planId: 'plan-9' })])]),
    ],
  });

  expect(await listAvailablePlanBlocks()).toEqual([
    {
      planId: 'plan-9',
      planTitle: 'Strength · Week 1 · Lower',
      planBlockCount: 1,
      block: block({ id: 'block-9', planId: 'plan-9' }),
    },
  ]);
});

it('lists a block once when a programme and a standalone plan both reach it', async () => {
  const shared = block({ id: 'shared-block' });
  seed({
    plans: [plan('plan-1', 'Push day', [shared])],
    programmes: [programme('prog-1', 'Strength', [plan('plan-1', 'Push day', [shared])])],
  });

  const rows = await listAvailablePlanBlocks();
  expect(rows).toHaveLength(1);
  expect(rows[0].planTitle).toBe('Push day');
});

it('keeps the first of two programmes offering one block', async () => {
  const shared = block({ id: 'shared-block' });
  seed({
    programmes: [
      programme('prog-1', 'First', [plan('plan-1', 'A', [shared])]),
      programme('prog-2', 'Second', [plan('plan-2', 'B', [shared])]),
    ],
  });

  const rows = await listAvailablePlanBlocks();
  expect(rows).toHaveLength(1);
  expect(rows[0].planTitle).toBe('First · A');
});

it('skips a plan or programme that no longer loads', async () => {
  seed({ plans: [plan('plan-1', 'Push day', [block()])] });
  listProgrammeSummaries.mockResolvedValue([{ id: 'gone-programme' }]);
  loadPlanDetail.mockResolvedValue(null);

  expect(await listAvailablePlanBlocks()).toEqual([]);
});
