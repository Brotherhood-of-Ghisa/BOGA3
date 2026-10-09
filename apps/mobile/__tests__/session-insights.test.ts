import { historyWeekBounds } from '@/src/utils/calendar-weeks';
import {
  calculateLinearPercentile,
  captureSessionShareImage,
  createCompletedSessionInsightsRepository,
  deriveExercisePersonalRecord,
  personalRecordCount,
  deriveSessionExerciseVolumeComparisons,
  deriveSessionPersonalRecords,
  shareSessionImage,
  summarizeCurrentSessionMuscleLoad,
  type CurrentSessionMuscleSummaryInput,
  type PersonalRecordSessionInput,
  type SessionInsightExerciseInput,
  type SessionInsightsStore,
} from "@/src/session-insights";
import { estimateOneRepMax } from "@/src/exercise-calculations";
import { captureRef } from "react-native-view-shot";

jest.mock("react-native-view-shot", () => ({
  captureRef: jest.fn().mockResolvedValue("file:///tmp/boga-session.png"),
  releaseCapture: jest.fn(),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const AT = new Date("2026-09-12T10:00:00.000Z");

const insightExercise = (
  overrides: Partial<SessionInsightExerciseInput> & {
    id: string;
    exerciseDefinitionId: string | null;
  },
): SessionInsightExerciseInput => ({
  orderIndex: 0,
  exerciseName: overrides.exerciseDefinitionId ?? "Unlinked exercise",
  sets: [],
  ...overrides,
});

const insightSet = (
  id: string,
  overrides: Partial<SessionInsightExerciseInput["sets"][number]> = {},
): SessionInsightExerciseInput["sets"][number] => ({
  id,
  orderIndex: 0,
  weightValue: "100",
  repsValue: "5",
  setType: null,
  performanceStatus: null,
  ...overrides,
});

const muscleInput = (
  overrides: Partial<CurrentSessionMuscleSummaryInput> = {},
): CurrentSessionMuscleSummaryInput => ({
  sessionId: "target",
  sessionAt: AT,
  exercises: [],
  exerciseDefinitions: [],
  muscleMappings: [],
  muscleGroups: [
    { id: "chest", displayName: "Chest", familyName: "Torso", sortOrder: 20 },
    {
      id: "triceps",
      displayName: "Triceps",
      familyName: "Arms",
      sortOrder: 30,
    },
    { id: "biceps", displayName: "Biceps", familyName: "Arms", sortOrder: 10 },
  ],
  ...overrides,
});

const completedSession = (
  overrides: Partial<PersonalRecordSessionInput> & { sessionId: string },
): PersonalRecordSessionInput => ({
  status: "completed",
  completedAt: AT,
  deletedAt: null,
  exercises: [],
  ...overrides,
});

describe("session image sharing", () => {
  it("captures an adaptive-height PNG at a fixed 1080 pixel width", async () => {
    await expect(
      captureSessionShareImage({} as never, { width: 360, height: 720 }),
    ).resolves.toBe("file:///tmp/boga-session.png");
    expect(captureRef).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        format: "png",
        result: "tmpfile",
        width: 1080,
        height: 2160,
      }),
    );
  });

  it("shares only the captured local PNG and treats native dismissal as a no-op", async () => {
    const client = {
      isAvailableAsync: jest.fn().mockResolvedValue(true),
      shareAsync: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      shareSessionImage("file:///tmp/session.png", client),
    ).resolves.toBeUndefined();
    expect(client.shareAsync).toHaveBeenCalledWith("file:///tmp/session.png", {
      dialogTitle: "Share your BOGA session",
      mimeType: "image/png",
      UTI: "public.png",
    });
  });

  it("fails clearly when image sharing is unavailable", async () => {
    const client = {
      isAvailableAsync: jest.fn().mockResolvedValue(false),
      shareAsync: jest.fn(),
    };

    await expect(
      shareSessionImage("file:///tmp/session.png", client),
    ).rejects.toThrow("Image sharing is unavailable");
    expect(client.shareAsync).not.toHaveBeenCalled();
  });
});

describe("summarizeCurrentSessionMuscleLoad", () => {
  it("keeps the summary empty until a valid performed set is confirmed", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exercises: [
          insightExercise({
            id: "bench-row",
            exerciseDefinitionId: "bench",
            sets: [
              insightSet("unconfirmed", { performanceStatus: "unperformed" }),
              insightSet("invalid", { repsValue: "0" }),
            ],
          }),
        ],
      }),
    );

    expect(summary).toEqual({
      state: "empty",
      workingSetCount: 0,
      mappedSetCount: 0,
      unmappedSetCount: 0,
      contributingMuscleCount: 0,
      muscles: [],
      workingSetsByMuscle: [],
    });
  });

  it("keeps a warm-up-only session empty: a warm-up is no set", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [{ bodyweightContribution: 0, id: "bench", loadInputMode: "per_side_load" }],
        exercises: [
          insightExercise({
            id: "bench-row",
            exerciseDefinitionId: "bench",
            sets: [insightSet("warm-up", { weightValue: "60", repsValue: "10", setType: "warm_up" })],
          }),
        ],
        muscleMappings: [{ exerciseDefinitionId: "bench", muscleGroupId: "chest", role: "primary" }],
      }),
    );

    expect(summary).toMatchObject({
      state: "empty",
      workingSetCount: 0,
      mappedSetCount: 0,
      unmappedSetCount: 0,
      muscles: [],
      workingSetsByMuscle: [],
    });
  });

  it("reuses per-side and role-weighted analytics while counting each physical set once", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { bodyweightContribution: 0, id: "barbell-bench", loadInputMode: "total_load" },
          { bodyweightContribution: 0, id: "curl", loadInputMode: "per_side_load" },
        ],
        exercises: [
          insightExercise({
            id: "bench-row",
            exerciseDefinitionId: "barbell-bench",
            exerciseName: "Barbell Bench Press",
            orderIndex: 1,
            sets: [
              insightSet("bench-warm-up", {
                orderIndex: 0,
                weightValue: "100",
                repsValue: "10",
                setType: "warm_up",
              }),
              insightSet("bench-working", {
                orderIndex: 1,
                weightValue: "100",
                repsValue: "5",
                setType: "rir_1",
              }),
            ],
          }),
          insightExercise({
            id: "curl-row",
            exerciseDefinitionId: "curl",
            exerciseName: "Curl",
            orderIndex: 2,
            sets: [
              insightSet("curl-working", {
                weightValue: "25",
                repsValue: "10",
                setType: "rir_0",
              }),
            ],
          }),
        ],
        muscleMappings: [
          {
            exerciseDefinitionId: "barbell-bench",
            muscleGroupId: "chest",
            role: "primary",
          },
          {
            exerciseDefinitionId: "barbell-bench",
            muscleGroupId: "triceps",
            role: "secondary",
          },
          {
            exerciseDefinitionId: "barbell-bench",
            muscleGroupId: "biceps",
            role: "stabilizer",
          },
          {
            exerciseDefinitionId: "curl",
            muscleGroupId: "biceps",
            role: "primary",
          },
        ],
      }),
    );

    expect(summary).toMatchObject({
      state: "mapped",
      // The counts read working sets: the bench warm-up adds nothing.
      workingSetCount: 2,
      mappedSetCount: 2,
      unmappedSetCount: 0,
      contributingMuscleCount: 3,
    });
    // Load reads working sets only: the 100 × 10 bench warm-up adds nothing,
    // so chest is the working 100 × 5 total load halved per side (250).
    expect(summary.muscles).toEqual([
      expect.objectContaining({
        id: "biceps",
        workingSetCount: 1,
        weightedVolume: 250,
        relativeVolume: 1,
      }),
      expect.objectContaining({
        id: "chest",
        workingSetCount: 1,
        weightedVolume: 250,
        relativeVolume: 1,
      }),
      expect.objectContaining({
        id: "triceps",
        workingSetCount: 1,
        weightedVolume: 125,
        relativeVolume: 0.5,
      }),
    ]);
    // A secondary set counts half; a stabilizer (biceps on bench) not at all.
    expect(summary.workingSetsByMuscle).toEqual([
      expect.objectContaining({ id: "biceps", primarySetCount: 1, secondarySetCount: 0, weightedSetCount: 1 }),
      expect.objectContaining({ id: "chest", primarySetCount: 1, secondarySetCount: 0, weightedSetCount: 1 }),
      expect.objectContaining({ id: "triceps", primarySetCount: 0, secondarySetCount: 1, weightedSetCount: 0.5 }),
    ]);
  });

  it("counts mapped working sets independently from entered load volume", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { bodyweightContribution: 0, id: "bodyweight", loadInputMode: "total_load" },
        ],
        exercises: [
          insightExercise({
            id: "bodyweight-row",
            exerciseDefinitionId: "bodyweight",
            sets: [
              insightSet("zero-load-working", {
                weightValue: "0",
                repsValue: "10",
                setType: "rir_3",
              }),
            ],
          }),
        ],
        muscleMappings: [
          {
            exerciseDefinitionId: "bodyweight",
            muscleGroupId: "chest",
            role: "primary",
          },
        ],
      }),
    );

    expect(summary.muscles).toEqual([]);
    expect(summary.workingSetsByMuscle).toEqual([
      expect.objectContaining({ id: "chest", primarySetCount: 1, secondarySetCount: 0, weightedSetCount: 1 }),
    ]);
  });

  it("counts a secondary working set as half a set for that muscle", () => {
    const sets = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        insightSet(`${prefix}-${index}`, { orderIndex: index, setType: "rir_1" }));
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { bodyweightContribution: 0, id: "bench", loadInputMode: "total_load" },
          { bodyweightContribution: 0, id: "press", loadInputMode: "total_load" },
          { bodyweightContribution: 0, id: "pushdown", loadInputMode: "total_load" },
        ],
        exercises: [
          insightExercise({ id: "bench-row", exerciseDefinitionId: "bench", orderIndex: 1, sets: sets("bench", 4) }),
          insightExercise({ id: "press-row", exerciseDefinitionId: "press", orderIndex: 2, sets: sets("press", 3) }),
          insightExercise({ id: "pushdown-row", exerciseDefinitionId: "pushdown", orderIndex: 3, sets: sets("pushdown", 3) }),
        ],
        muscleMappings: [
          { exerciseDefinitionId: "bench", muscleGroupId: "chest", role: "primary" },
          { exerciseDefinitionId: "bench", muscleGroupId: "triceps", role: "secondary" },
          { exerciseDefinitionId: "press", muscleGroupId: "triceps", role: "secondary" },
          { exerciseDefinitionId: "pushdown", muscleGroupId: "triceps", role: "primary" },
          // A muscle mapped twice to one exercise counts each set once, at its strongest role.
          { exerciseDefinitionId: "pushdown", muscleGroupId: "triceps", role: "secondary" },
        ],
      }),
    );

    // Triceps: 3 direct + 7 indirect sets = 6.5, not the 10 sets it touched.
    expect(summary.workingSetsByMuscle).toEqual([
      expect.objectContaining({ id: "triceps", primarySetCount: 3, secondarySetCount: 7, weightedSetCount: 6.5 }),
      expect.objectContaining({ id: "chest", primarySetCount: 4, secondarySetCount: 0, weightedSetCount: 4 }),
    ]);
  });

  it("reports partially mapped and fully unmapped work without zero-valued muscles", () => {
    const partial = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { bodyweightContribution: 0, id: "mapped", loadInputMode: "per_side_load" },
          { bodyweightContribution: 0, id: "unmapped", loadInputMode: "per_side_load" },
          { bodyweightContribution: 0, id: "stabilizer-only", loadInputMode: "per_side_load" },
        ],
        exercises: [
          insightExercise({
            id: "mapped-row",
            exerciseDefinitionId: "mapped",
            sets: [insightSet("mapped-set")],
          }),
          insightExercise({
            id: "unmapped-row",
            exerciseDefinitionId: "unmapped",
            orderIndex: 1,
            sets: [insightSet("unmapped-set")],
          }),
          insightExercise({
            id: "stabilizer-row",
            exerciseDefinitionId: "stabilizer-only",
            orderIndex: 2,
            sets: [insightSet("stabilizer-set")],
          }),
        ],
        muscleMappings: [
          {
            exerciseDefinitionId: "mapped",
            muscleGroupId: "chest",
            role: "primary",
          },
          {
            exerciseDefinitionId: "stabilizer-only",
            muscleGroupId: "biceps",
            role: "stabilizer",
          },
        ],
      }),
    );

    expect(partial).toMatchObject({
      state: "mapped",
      workingSetCount: 3,
      mappedSetCount: 1,
      unmappedSetCount: 2,
      contributingMuscleCount: 1,
    });
    expect(partial.muscles.map((muscle) => muscle.id)).toEqual(["chest"]);

    const unmapped = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exercises: [
          insightExercise({
            id: "unmapped-row",
            exerciseDefinitionId: "unmapped",
            sets: [insightSet("unmapped-set")],
          }),
        ],
      }),
    );
    expect(unmapped).toMatchObject({
      state: "unmapped",
      workingSetCount: 1,
      mappedSetCount: 0,
      unmappedSetCount: 1,
      muscles: [],
    });
  });

  it("uses taxonomy order as the stable tie-breaker and excludes tombstones", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [{ bodyweightContribution: 0, id: "press", loadInputMode: "per_side_load" }],
        exercises: [
          insightExercise({
            id: "press-row",
            exerciseDefinitionId: "press",
            sets: [
              insightSet("kept"),
              insightSet("deleted", { deletedAt: AT }),
            ],
          }),
        ],
        muscleMappings: [
          {
            exerciseDefinitionId: "press",
            muscleGroupId: "chest",
            role: "primary",
          },
          {
            exerciseDefinitionId: "press",
            muscleGroupId: "biceps",
            role: "primary",
          },
        ],
      }),
    );

    expect(summary.workingSetCount).toBe(1);
    expect(summary.muscles.map((muscle) => muscle.id)).toEqual([
      "biceps",
      "chest",
    ]);
    expect(summary.muscles.every((muscle) => muscle.relativeVolume === 1)).toBe(
      true,
    );
  });

  it("rejects an invalid session timestamp instead of consulting the wall clock", () => {
    expect(() =>
      summarizeCurrentSessionMuscleLoad(
        muscleInput({ sessionAt: new Date("invalid") }),
      ),
    ).toThrow("sessionAt must be a valid Date");
  });
});

describe("deriveSessionExerciseVolumeComparisons", () => {
  it("uses linear interpolation for odd, even, and quartile percentiles", () => {
    expect(calculateLinearPercentile([100, 200, 300], 0.5)).toBe(200);
    expect(calculateLinearPercentile([100, 200, 300, 400], 0.5)).toBe(250);
    expect(calculateLinearPercentile([100, 200], 0.05)).toBe(105);
    expect(calculateLinearPercentile([100, 200], 0.95)).toBe(195);
    expect(calculateLinearPercentile([100, 200, 300, 400, 500, 600], 0.25)).toBe(225);
    expect(calculateLinearPercentile([100, 200, 300, 400, 500, 600], 0.75)).toBe(475);
  });

  it("combines repeated target blocks, leaves warm-ups out of volume, and excludes invalid work", () => {
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "target-bench-a",
          orderIndex: 2,
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          sets: [
            insightSet("warm-up", {
              weightValue: "100",
              repsValue: "5",
              setType: "warm_up",
            }),
            insightSet("unconfirmed", {
              weightValue: "900",
              repsValue: "5",
              setType: "rir_0",
              performanceStatus: "unperformed",
            }),
          ],
        }),
        insightExercise({
          id: "target-bench-b",
          orderIndex: 4,
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          sets: [
            insightSet("working", {
              weightValue: "120",
              repsValue: "5",
              setType: "rir_3",
            }),
            insightSet("deleted", {
              weightValue: "500",
              repsValue: "5",
              deletedAt: AT,
            }),
          ],
        }),
      ],
    });
    const history = [500, 700, 900].map((volume, index) =>
      completedSession({
        sessionId: `history-${index}`,
        completedAt: new Date(`2026-09-0${index + 1}T10:00:00.000Z`),
        exercises: [
          insightExercise({
            id: `history-bench-${index}`,
            exerciseDefinitionId: "bench",
            exerciseName: "Bench Press",
            sets: [
              insightSet(`history-set-${index}`, {
                weightValue: `${volume}`,
                repsValue: "1",
              }),
            ],
          }),
        ],
      }),
    );

    expect(
      deriveSessionExerciseVolumeComparisons({
        targetSession: target,
        historicalSessions: history,
      }),
    ).toEqual([
      {
        exerciseDefinitionId: "bench",
        exerciseName: "Bench Press",
        sessionExerciseIds: ["target-bench-a", "target-bench-b"],
        sessionExerciseOrderIndex: 2,
        // The working 120 × 5 only; the 100 × 5 warm-up is neither a set
        // nor volume.
        workingSetCount: 1,
        currentVolume: 600,
        historicalSessionCount: 3,
        medianVolume: 700,
        percentile25Volume: 600,
        percentile75Volume: 800,
        state: "distribution",
      },
    ]);
  });

  it("leaves an uncalculable block out of the Volume and skips an overflowed baseline with no count", () => {
    const corrupt = { policy: "personal" as const, bodyweightContribution: 0, loadInputMode: "sideways" as "total_load" };
    const huge = `1${"0".repeat(306)}`;
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({ id: "t-a", exerciseDefinitionId: "bench", exerciseName: "Bench Press",
          sets: [insightSet("t-a-1", { weightValue: "100", repsValue: "5" })] }),
        insightExercise({ id: "t-b", orderIndex: 1, exerciseDefinitionId: "bench", exerciseName: "Bench Press",
          loadContext: corrupt, sets: [insightSet("t-b-1", { weightValue: "300", repsValue: "5" })] }),
      ],
    });
    const overflowed = completedSession({
      sessionId: "history-overflow",
      completedAt: new Date("2026-09-01T10:00:00.000Z"),
      exercises: [insightExercise({ id: "h-o", exerciseDefinitionId: "bench", exerciseName: "Bench Press",
        sets: ["1", "2", "3"].map(id => insightSet(`h-o-${id}`, { weightValue: huge, repsValue: "60" })) })],
    });
    const known = completedSession({
      sessionId: "history-known",
      completedAt: new Date("2026-09-02T10:00:00.000Z"),
      exercises: [insightExercise({ id: "h-k", exerciseDefinitionId: "bench", exerciseName: "Bench Press",
        sets: [insightSet("h-k-1", { weightValue: "80", repsValue: "5" })] })],
    });

    const [comparison] = deriveSessionExerciseVolumeComparisons({ targetSession: target, historicalSessions: [overflowed, known] });
    expect(comparison).toEqual(expect.objectContaining({
      workingSetCount: 2, currentVolume: 500, historicalSessionCount: 1, medianVolume: 400, state: "single-baseline",
    }));
    expect(comparison).not.toHaveProperty("excludedHistoricalSessionCount");
    // A target whose own sum overflows has no comparison.
    expect(deriveSessionExerciseVolumeComparisons({
      targetSession: { ...overflowed, sessionId: "later", completedAt: AT }, historicalSessions: [known],
    })[0]).toEqual(expect.objectContaining({ currentVolume: null, historicalSessionCount: 0, state: "unavailable" }));
  });

  it("compares no warm-up-only exercise and takes no baseline from one", () => {
    const warmUp = (id: string) => insightSet(id, { weightValue: "200", repsValue: "10", setType: "warm_up" });
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({ id: "target-bench", exerciseDefinitionId: "bench", sets: [warmUp("target-bench-warm-up")] }),
        insightExercise({
          id: "target-squat",
          orderIndex: 1,
          exerciseDefinitionId: "squat",
          sets: [warmUp("target-squat-warm-up"), insightSet("target-squat-working", { weightValue: "100", repsValue: "5" })],
        }),
      ],
    });
    const history = [
      completedSession({
        sessionId: "history-warm-up-only",
        completedAt: new Date("2026-09-01T10:00:00.000Z"),
        exercises: [insightExercise({ id: "history-squat-a", exerciseDefinitionId: "squat", sets: [warmUp("history-warm-up")] })],
      }),
      completedSession({
        sessionId: "history-working",
        completedAt: new Date("2026-09-02T10:00:00.000Z"),
        exercises: [insightExercise({
          id: "history-squat-b",
          exerciseDefinitionId: "squat",
          sets: [warmUp("history-mixed-warm-up"), insightSet("history-working", { weightValue: "80", repsValue: "5" })],
        })],
      }),
    ];

    expect(
      deriveSessionExerciseVolumeComparisons({ targetSession: target, historicalSessions: history }),
    ).toEqual([
      expect.objectContaining({
        exerciseDefinitionId: "squat",
        workingSetCount: 1,
        currentVolume: 500,
        historicalSessionCount: 1,
        medianVolume: 400,
        state: "single-baseline",
      }),
    ]);
  });

  it("does not compare unlinked legacy exercises by display name", () => {
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "legacy-target",
          exerciseDefinitionId: null,
          exerciseName: "Legacy Press",
          sets: [insightSet("target-set")],
        }),
      ],
    });
    const history = completedSession({
      sessionId: "history",
      completedAt: new Date("2026-09-01T10:00:00.000Z"),
      exercises: [
        insightExercise({
          id: "legacy-history",
          exerciseDefinitionId: null,
          exerciseName: "Legacy Press",
          sets: [insightSet("history-set")],
        }),
      ],
    });

    expect(
      deriveSessionExerciseVolumeComparisons({
        targetSession: target,
        historicalSessions: [history],
      }),
    ).toEqual([
      expect.objectContaining({
        exerciseDefinitionId: null,
        currentVolume: 500,
        historicalSessionCount: 0,
        medianVolume: null,
        state: "no-history",
      }),
    ]);
  });

  it("distinguishes a single baseline from a constant historical distribution", () => {
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "target-bench",
          exerciseDefinitionId: "bench",
          sets: [insightSet("target-set", { weightValue: "0" })],
        }),
      ],
    });
    const makeHistory = (sessionId: string, day: string) =>
      completedSession({
        sessionId,
        completedAt: new Date(`2026-09-${day}T10:00:00.000Z`),
        exercises: [
          insightExercise({
            id: `${sessionId}-bench`,
            exerciseDefinitionId: "bench",
            sets: [insightSet(`${sessionId}-set`, { weightValue: "0" })],
          }),
        ],
      });

    const single = deriveSessionExerciseVolumeComparisons({
      targetSession: target,
      historicalSessions: [makeHistory("one", "01")],
    })[0];
    const constant = deriveSessionExerciseVolumeComparisons({
      targetSession: target,
      historicalSessions: [makeHistory("one", "01"), makeHistory("two", "02")],
    })[0];

    expect(single).toEqual(
      expect.objectContaining({ state: "single-baseline", medianVolume: 0 }),
    );
    expect(constant).toEqual(
      expect.objectContaining({ state: "constant-baseline", medianVolume: 0 }),
    );
  });

  it("excludes future, same-time later-id, active, and deleted sessions", () => {
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "target-bench",
          exerciseDefinitionId: "bench",
          sets: [insightSet("target-set")],
        }),
      ],
    });
    const disallowed = [
      completedSession({
        sessionId: "future",
        completedAt: new Date("2026-09-13T10:00:00.000Z"),
      }),
      completedSession({ sessionId: "z-same-time" }),
      completedSession({
        sessionId: "active",
        status: "active",
        completedAt: null,
      }),
      completedSession({ sessionId: "deleted", deletedAt: AT }),
    ].map((session) => ({
      ...session,
      exercises: [
        insightExercise({
          id: `${session.sessionId}-bench`,
          exerciseDefinitionId: "bench",
          sets: [insightSet(`${session.sessionId}-set`)],
        }),
      ],
    }));

    expect(
      deriveSessionExerciseVolumeComparisons({
        targetSession: target,
        historicalSessions: disallowed,
      })[0],
    ).toEqual(
      expect.objectContaining({
        historicalSessionCount: 0,
        state: "no-history",
      }),
    );
  });
});

describe("deriveExercisePersonalRecord", () => {
  const exercise = insightExercise({
    id: "bench-row",
    exerciseDefinitionId: "bench",
    exerciseName: "Bench Press",
    sets: [insightSet("set-b", { weightValue: "110", repsValue: "5" })],
  });

  const baselineOf = (oneRepMax: number, weight: number, reps: number, volume: number | null = null) => ({
    oneRepMax,
    weight: { weight, reps },
    volume,
  });

  it("returns the best entered set only for a strict improvement over an existing baseline", () => {
    const historicalBest = estimateOneRepMax(100, 5) as number;
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise],
      baseline: baselineOf(historicalBest, 120, 1),
    });

    expect(record).toEqual({
      exerciseDefinitionId: "bench",
      exerciseName: "Bench Press",
      sessionExerciseId: "bench-row",
      sessionExerciseOrderIndex: 0,
      sets: [{
        sessionExerciseId: "bench-row",
        setId: "set-b",
        setOrderIndex: 0,
        weight: 110,
        reps: 5,
        estimatedOneRepMax: expect.any(Number),
        oneRepMax: true,
        topWeight: false,
      }],
      volume: null,
      baseline: baselineOf(historicalBest, 120, 1),
    });
    expect(record?.sets[0].estimatedOneRepMax).toBeCloseTo(
      estimateOneRepMax(110, 5) as number,
    );
    expect(personalRecordCount(record!)).toBe(1);
  });

  it.each([
    ["an equal 1RM, Weight and Volume", baselineOf(estimateOneRepMax(110, 5) as number, 110, 5, 550)],
    ["a 1RM, Weight and Volume above current", baselineOf((estimateOneRepMax(110, 5) as number) + 1, 110, 6, 551)],
    ["no baseline", null],
    ["a zero baseline", baselineOf(0, 0, 10, 0)],
  ])(
    "does not label %s as a PR",
    (_label, baseline) => {
      expect(
        deriveExercisePersonalRecord({
          exerciseDefinitionId: "bench",
          exercises: [exercise],
          baseline,
        }),
      ).toBeNull();
    },
  );

  it("takes a Weight record on its own, comparing weight then reps", () => {
    const above1rm = (estimateOneRepMax(110, 5) as number) + 1;
    expect(deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise],
      baseline: baselineOf(above1rm, 110, 4),
    })).toMatchObject({ sets: [{ setId: "set-b", oneRepMax: false, topWeight: true, weight: 110, reps: 5 }], volume: null });
    // A 1RM-only baseline (no earlier Weight) has nothing for a Weight to beat.
    expect(deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise],
      baseline: { oneRepMax: above1rm, weight: null, volume: null },
    })).toBeNull();
  });

  it("names one set once when it takes both the 1RM and the Weight record", () => {
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise],
      baseline: baselineOf(estimateOneRepMax(100, 5) as number, 100, 5),
    });
    expect(record?.sets).toEqual([expect.objectContaining({ setId: "set-b", oneRepMax: true, topWeight: true })]);
    expect(personalRecordCount(record!)).toBe(2);
  });

  it("takes every record: the best 1RM's set, then the top Weight's, then the Volume", () => {
    const mixed = insightExercise({
      ...exercise,
      sets: [
        insightSet("heavy", { orderIndex: 0, weightValue: "120", repsValue: "1" }),
        insightSet("reps", { orderIndex: 1, weightValue: "100", repsValue: "10" }),
      ],
    });
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [mixed],
      baseline: baselineOf(estimateOneRepMax(100, 5) as number, 110, 1, 1000),
    });
    expect(record?.sets).toEqual([
      expect.objectContaining({ setId: "reps", oneRepMax: true, topWeight: false }),
      expect.objectContaining({ setId: "heavy", oneRepMax: false, topWeight: true }),
    ]);
    expect(record?.volume).toBe(1120);
    expect(personalRecordCount(record!)).toBe(3);
  });

  it("takes a Volume record with no strength record, on the exercise's first block", () => {
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise],
      baseline: baselineOf(1000, 200, 1, 500),
    });
    expect(record).toMatchObject({ sessionExerciseId: "bench-row", sets: [], volume: 550 });
    expect(personalRecordCount(record!)).toBe(1);
  });

  it("takes a Volume record from a session that left an uncalculable block out ([[copy.no-inline-explanation]])", () => {
    const corrupt = insightExercise({
      id: "bench-corrupt",
      orderIndex: 1,
      exerciseDefinitionId: "bench",
      exerciseName: "Bench Press",
      loadContext: { policy: "personal", bodyweightContribution: 0, loadInputMode: "sideways" as "total_load" },
      sets: [insightSet("set-corrupt", { weightValue: "50", repsValue: "5" })],
    });
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise, corrupt],
      baseline: baselineOf(1000, 200, 1, 500),
    });
    // 110 × 5 = 550 beats 500; the 50 × 5 block is left out, not a blocker.
    expect(record).toMatchObject({ sets: [], volume: 550 });
  });

  it("ignores unconfirmed work and resolves ties by set order then stable set id", () => {
    const tiedExercise = insightExercise({
      ...exercise,
      sets: [
        insightSet("unconfirmed", {
          orderIndex: 0,
          weightValue: "500",
          repsValue: "10",
          performanceStatus: "unperformed",
        }),
        insightSet("set-z", {
          orderIndex: 2,
          weightValue: "120",
          repsValue: "5",
        }),
        insightSet("set-b", {
          orderIndex: 1,
          weightValue: "120",
          repsValue: "5",
        }),
        insightSet("set-a", {
          orderIndex: 1,
          weightValue: "120",
          repsValue: "5",
        }),
      ],
    });
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [tiedExercise],
      baseline: baselineOf(1, 1, 1),
    });

    expect(record?.sets.map((set) => set.setId)).toEqual(["set-a"]);
  });

  it("never takes a warm-up heavier than the working sets as the PR set", () => {
    const warmUpHeavier = insightExercise({
      ...exercise,
      sets: [
        insightSet("warm-up", { orderIndex: 0, weightValue: "200", repsValue: "5", setType: "warm_up" }),
        insightSet("working", { orderIndex: 1, weightValue: "110", repsValue: "5", setType: "rir_1" }),
      ],
    });
    const historicalBest = estimateOneRepMax(100, 5) as number;

    expect(deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [warmUpHeavier],
      baseline: baselineOf(historicalBest, 100, 5),
    })).toMatchObject({ sets: [{ setId: "working", weight: 110 }] });
    // Only a warm-up beats the baseline: no PR.
    expect(deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [warmUpHeavier],
      baseline: baselineOf(estimateOneRepMax(150, 5) as number, 150, 5),
    })).toBeNull();
  });
});

describe("deriveSessionPersonalRecords", () => {
  it("never lets an earlier warm-up set the baseline", () => {
    const records = deriveSessionPersonalRecords({
      targetSession: completedSession({
        sessionId: "target",
        exercises: [insightExercise({
          id: "target-row",
          exerciseDefinitionId: "bench",
          sets: [insightSet("target-set", { weightValue: "110", setType: "rir_2" })],
        })],
      }),
      historicalSessions: [
        completedSession({
          sessionId: "earlier",
          completedAt: new Date("2026-09-11T10:00:00.000Z"),
          exercises: [insightExercise({
            id: "earlier-row",
            exerciseDefinitionId: "bench",
            sets: [
              insightSet("earlier-warm-up", { orderIndex: 0, weightValue: "200", setType: "warm_up" }),
              insightSet("earlier-working", { orderIndex: 1, weightValue: "100", setType: "rir_2" }),
            ],
          })],
        }),
        // A warm-up-only session is no baseline at all.
        completedSession({
          sessionId: "warm-up-only",
          completedAt: new Date("2026-09-11T11:00:00.000Z"),
          exercises: [insightExercise({
            id: "warm-up-only-row",
            exerciseDefinitionId: "bench",
            sets: [insightSet("only-warm-up", { weightValue: "300", setType: "warm_up" })],
          })],
        }),
      ],
    });

    expect(records).toEqual([expect.objectContaining({
      sets: [expect.objectContaining({ setId: "target-set", weight: 110 })],
    })]);
    expect(records[0].baseline.oneRepMax).toBeCloseTo(estimateOneRepMax(100, 5) as number);
    expect(records[0].baseline.weight).toEqual({ weight: 100, reps: 5 });
    // The working set's volume only: the warm-ups add none.
    expect(records[0].baseline.volume).toBe(500);
  });

  it("uses only earlier completed, non-deleted history in (completedAt, sessionId) order", () => {
    const target = completedSession({
      sessionId: "target-b",
      exercises: [
        insightExercise({
          id: "target-row",
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          sets: [insightSet("target-set", { weightValue: "110" })],
        }),
      ],
    });
    const historyExercise = (weightValue: string) => [
      insightExercise({
        id: `history-${weightValue}`,
        exerciseDefinitionId: "bench",
        sets: [insightSet(`history-set-${weightValue}`, { weightValue })],
      }),
    ];
    const records = deriveSessionPersonalRecords({
      targetSession: target,
      historicalSessions: [
        completedSession({
          sessionId: "earlier",
          completedAt: new Date("2026-09-11T10:00:00.000Z"),
          exercises: historyExercise("100"),
        }),
        completedSession({
          sessionId: "target-a",
          exercises: historyExercise("105"),
        }),
        completedSession({
          sessionId: "target-c",
          exercises: historyExercise("500"),
        }),
        completedSession({
          sessionId: "deleted",
          completedAt: new Date("2026-09-10T10:00:00.000Z"),
          deletedAt: AT,
          exercises: historyExercise("600"),
        }),
        completedSession({
          sessionId: "later",
          completedAt: new Date("2026-09-13T10:00:00.000Z"),
          exercises: historyExercise("700"),
        }),
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0].baseline.oneRepMax).toBeCloseTo(
      estimateOneRepMax(105, 5) as number,
    );
  });

  it("replays the Weight record too: a heavier set below the 1RM record is a Weight PR", () => {
    const records = deriveSessionPersonalRecords({
      targetSession: completedSession({
        sessionId: "target",
        exercises: [insightExercise({
          id: "target-row",
          exerciseDefinitionId: "bench",
          sets: [insightSet("target-set", { weightValue: "105", repsValue: "3" })],
        })],
      }),
      historicalSessions: [completedSession({
        sessionId: "earlier",
        completedAt: new Date("2026-09-11T10:00:00.000Z"),
        exercises: [insightExercise({
          id: "earlier-row",
          exerciseDefinitionId: "bench",
          sets: [insightSet("earlier-set", { weightValue: "100", repsValue: "10" })],
        })],
      })],
    });

    expect(records).toEqual([expect.objectContaining({
      sets: [expect.objectContaining({ setId: "target-set", oneRepMax: false, topWeight: true })],
      volume: null,
    })]);
    expect(records[0].baseline.weight).toEqual({ weight: 100, reps: 10 });
  });

  it("deduplicates repeated definition blocks and follows first exercise order", () => {
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "curl-row",
          exerciseDefinitionId: "curl",
          exerciseName: "Curl",
          orderIndex: 0,
          sets: [insightSet("curl-set", { weightValue: "30" })],
        }),
        insightExercise({
          id: "bench-row-a",
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          orderIndex: 1,
          sets: [insightSet("bench-set-a", { weightValue: "110" })],
        }),
        insightExercise({
          id: "bench-row-b",
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          orderIndex: 2,
          sets: [insightSet("bench-set-b", { weightValue: "120" })],
        }),
        insightExercise({
          id: "unlinked",
          exerciseDefinitionId: null,
          orderIndex: 3,
          sets: [insightSet("unlinked-set", { weightValue: "900" })],
        }),
      ],
    });
    const history = completedSession({
      sessionId: "history",
      completedAt: new Date("2026-09-01T10:00:00.000Z"),
      exercises: [
        insightExercise({
          id: "history-bench",
          exerciseDefinitionId: "bench",
          sets: [insightSet("history-bench-set", { weightValue: "100" })],
        }),
        insightExercise({
          id: "history-curl",
          exerciseDefinitionId: "curl",
          orderIndex: 1,
          sets: [insightSet("history-curl-set", { weightValue: "20" })],
        }),
      ],
    });

    const records = deriveSessionPersonalRecords({
      targetSession: target,
      historicalSessions: [history],
    });

    expect(records.map((record) => record.exerciseDefinitionId)).toEqual([
      "curl",
      "bench",
    ]);
    expect(records[1]).toEqual(
      expect.objectContaining({
        sessionExerciseOrderIndex: 1,
        sessionExerciseId: "bench-row-a",
        sets: [expect.objectContaining({ sessionExerciseId: "bench-row-b", setId: "bench-set-b" })],
      }),
    );
  });

  it("gives a tie across repeated blocks to the first set in session order (block, then set)", () => {
    // Block A set 2 and block B set 1 tie on 1RM; block A comes first in the session.
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "bench-row-b",
          exerciseDefinitionId: "bench",
          orderIndex: 1,
          sets: [insightSet("bench-b-1", { weightValue: "120" })],
        }),
        insightExercise({
          id: "bench-row-a",
          exerciseDefinitionId: "bench",
          orderIndex: 0,
          sets: [
            insightSet("bench-a-1", { weightValue: "80" }),
            insightSet("bench-a-2", { orderIndex: 1, weightValue: "120" }),
          ],
        }),
      ],
    });
    const history = completedSession({
      sessionId: "history",
      completedAt: new Date("2026-09-01T10:00:00.000Z"),
      exercises: [
        insightExercise({
          id: "history-bench",
          exerciseDefinitionId: "bench",
          sets: [insightSet("history-bench-set", { weightValue: "100" })],
        }),
      ],
    });

    const [record] = deriveSessionPersonalRecords({ targetSession: target, historicalSessions: [history] });

    expect(record.sets).toEqual([expect.objectContaining({ sessionExerciseId: "bench-row-a", setId: "bench-a-2" })]);
  });

  it("omits no-baseline exercises and deleted target work", () => {
    const target = completedSession({
      sessionId: "target",
      exercises: [
        insightExercise({
          id: "new-exercise",
          exerciseDefinitionId: "new",
          sets: [insightSet("new-set", { weightValue: "500" })],
        }),
        insightExercise({
          id: "deleted-exercise",
          exerciseDefinitionId: "bench",
          deletedAt: AT,
          sets: [insightSet("deleted-exercise-set", { weightValue: "500" })],
        }),
        insightExercise({
          id: "bench",
          exerciseDefinitionId: "bench",
          orderIndex: 2,
          sets: [
            insightSet("deleted-set", { weightValue: "500", deletedAt: AT }),
          ],
        }),
      ],
    });
    const history = completedSession({
      sessionId: "history",
      completedAt: new Date("2026-09-01T10:00:00.000Z"),
      exercises: [
        insightExercise({
          id: "history-bench",
          exerciseDefinitionId: "bench",
          sets: [insightSet("history-set")],
        }),
      ],
    });

    expect(
      deriveSessionPersonalRecords({
        targetSession: target,
        historicalSessions: [history],
      }),
    ).toEqual([]);
  });
});

describe("createCompletedSessionInsightsRepository", () => {
  const buildStore = (
    overrides: Partial<SessionInsightsStore> = {},
  ): SessionInsightsStore => ({
    loadTargetSession: jest.fn().mockResolvedValue(null),
    loadEarlierCompletedSessions: jest.fn().mockResolvedValue([]),
    loadSessionExercises: jest.fn().mockResolvedValue([]),
    loadExerciseSets: jest.fn().mockResolvedValue([]),
    loadEarlierRecordBaselines: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  });

  it("returns null without loading children when the target is unavailable", async () => {
    const store = buildStore();
    const repository = createCompletedSessionInsightsRepository(store);

    await expect(repository.loadInsights("missing", 52)).resolves.toBeNull();
    expect(store.loadEarlierCompletedSessions).not.toHaveBeenCalled();
    expect(store.loadSessionExercises).not.toHaveBeenCalled();
  });

  it("assembles the target and historical graphs, and takes PRs against the earlier bests the facts supply", async () => {
    const target = completedSession({ sessionId: "target" });
    const history = completedSession({
      sessionId: "history",
      completedAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    const store = buildStore({
      loadTargetSession: jest.fn().mockResolvedValue(target),
      loadEarlierCompletedSessions: jest.fn().mockResolvedValue([history]),
      loadSessionExercises: jest.fn().mockResolvedValue([
        {
          id: "target-row",
          sessionId: "target",
          orderIndex: 0,
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          deletedAt: null,
        },
        {
          id: "history-row",
          sessionId: "history",
          orderIndex: 0,
          exerciseDefinitionId: "bench",
          exerciseName: "Bench Press",
          deletedAt: null,
        },
      ]),
      loadExerciseSets: jest.fn().mockResolvedValue([
        {
          ...insightSet("target-set", { weightValue: "110" }),
          sessionExerciseId: "target-row",
        },
        {
          ...insightSet("history-set", { weightValue: "100" }),
          sessionExerciseId: "history-row",
        },
      ]),
      loadEarlierRecordBaselines: jest.fn().mockResolvedValue(
        new Map([["bench", { oneRepMax: 100, weight: { weight: 100, reps: 5 }, volume: 500 }]]),
      ),
    });
    const repository = createCompletedSessionInsightsRepository(store);

    const insights = await repository.loadInsights("target", 52);

    expect(store.loadEarlierCompletedSessions).toHaveBeenCalledWith({
      completedAt: AT,
      start: historyWeekBounds(52, AT).start,
      targetSessionId: "target",
    });
    expect(store.loadEarlierRecordBaselines).toHaveBeenCalledWith({
      target: { sessionId: "target", completedAt: AT },
      exerciseDefinitionIds: ["bench"],
    });
    expect(insights).toEqual({
      muscleVolumeComparisons: [],
      personalRecords: [
        expect.objectContaining({
          exerciseDefinitionId: "bench",
          sets: [expect.objectContaining({ setId: "target-set", oneRepMax: true, topWeight: true })],
          volume: 550,
          baseline: { oneRepMax: 100, weight: { weight: 100, reps: 5 }, volume: 500 },
        }),
      ],
      exerciseVolumeComparisons: [
        expect.objectContaining({
          exerciseDefinitionId: "bench",
          currentVolume: 550,
          medianVolume: 500,
        }),
      ],
    });
  });
});
