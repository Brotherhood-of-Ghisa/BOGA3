import {
  calculateLinearPercentile,
  captureSessionShareImage,
  createCompletedSessionInsightsRepository,
  deriveExercisePersonalRecord,
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
      performedSetCount: 0,
      workingSetCount: 0,
      mappedSetCount: 0,
      unmappedSetCount: 0,
      contributingMuscleCount: 0,
      muscles: [],
      workingSetsByMuscle: [],
    });
  });

  it("reuses per-side and role-weighted analytics while counting each physical set once", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { id: "barbell-bench", loadInputMode: "total_load" },
          { id: "curl", loadInputMode: "per_side_load" },
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
      performedSetCount: 3,
      workingSetCount: 2,
      mappedSetCount: 3,
      unmappedSetCount: 0,
      contributingMuscleCount: 3,
    });
    expect(summary.muscles).toEqual([
      expect.objectContaining({
        id: "chest",
        workingSetCount: 1,
        weightedVolume: 750,
        relativeVolume: 1,
      }),
      expect.objectContaining({
        id: "triceps",
        workingSetCount: 1,
        weightedVolume: 375,
        relativeVolume: 0.5,
      }),
      expect.objectContaining({
        id: "biceps",
        workingSetCount: 1,
        weightedVolume: 250,
        relativeVolume: 1 / 3,
      }),
    ]);
    expect(summary.workingSetsByMuscle).toEqual([
      expect.objectContaining({ id: "biceps", workingSetCount: 1 }),
      expect.objectContaining({ id: "chest", workingSetCount: 1 }),
      expect.objectContaining({ id: "triceps", workingSetCount: 1 }),
    ]);
  });

  it("counts mapped working sets independently from entered load volume", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { id: "bodyweight", loadInputMode: "total_load" },
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
      expect.objectContaining({ id: "chest", workingSetCount: 1 }),
    ]);
  });

  it("reports partially mapped and fully unmapped work without zero-valued muscles", () => {
    const partial = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { id: "mapped", loadInputMode: "per_side_load" },
          { id: "unmapped", loadInputMode: "per_side_load" },
          { id: "stabilizer-only", loadInputMode: "per_side_load" },
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
      performedSetCount: 3,
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
      performedSetCount: 1,
      mappedSetCount: 0,
      unmappedSetCount: 1,
      muscles: [],
    });
  });

  it("uses taxonomy order as the stable tie-breaker and excludes tombstones", () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [{ id: "press", loadInputMode: "per_side_load" }],
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

    expect(summary.performedSetCount).toBe(1);
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
  it("uses linear interpolation for odd, even, and tail percentiles", () => {
    expect(calculateLinearPercentile([100, 200, 300], 0.5)).toBe(200);
    expect(calculateLinearPercentile([100, 200, 300, 400], 0.5)).toBe(250);
    expect(calculateLinearPercentile([100, 200], 0.05)).toBe(105);
    expect(calculateLinearPercentile([100, 200], 0.95)).toBe(195);
  });

  it("combines repeated target blocks, includes warm-ups, and excludes invalid work", () => {
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
        setCount: 2,
        workingSetCount: 1,
        currentVolume: 1100,
        historicalSessionCount: 3,
        medianVolume: 700,
        percentile5Volume: 520,
        percentile95Volume: 880,
        state: "distribution",
      },
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

  it("returns the best entered set only for a strict improvement over an existing baseline", () => {
    const historicalBest = estimateOneRepMax(100, 5) as number;
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: "bench",
      exercises: [exercise],
      historicalBestEstimatedOneRepMax: historicalBest,
    });

    expect(record).toEqual(
      expect.objectContaining({
        exerciseDefinitionId: "bench",
        exerciseName: "Bench Press",
        sessionExerciseId: "bench-row",
        setId: "set-b",
        weight: 110,
        reps: 5,
        historicalBestEstimatedOneRepMax: historicalBest,
      }),
    );
    expect(record?.estimatedOneRepMax).toBeCloseTo(
      estimateOneRepMax(110, 5) as number,
    );
  });

  it.each([
    ["equal", estimateOneRepMax(110, 5) as number],
    ["above current", (estimateOneRepMax(110, 5) as number) + 1],
    ["no baseline", null],
  ])(
    "does not label %s as a PR",
    (_label, historicalBestEstimatedOneRepMax) => {
      expect(
        deriveExercisePersonalRecord({
          exerciseDefinitionId: "bench",
          exercises: [exercise],
          historicalBestEstimatedOneRepMax,
        }),
      ).toBeNull();
    },
  );

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
      historicalBestEstimatedOneRepMax: 1,
    });

    expect(record?.setId).toBe("set-a");
  });
});

describe("deriveSessionPersonalRecords", () => {
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
    expect(records[0].historicalBestEstimatedOneRepMax).toBeCloseTo(
      estimateOneRepMax(105, 5) as number,
    );
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
        sessionExerciseId: "bench-row-b",
        setId: "bench-set-b",
      }),
    );
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
    ...overrides,
  });

  it("returns null without loading children when the target is unavailable", async () => {
    const store = buildStore();
    const repository = createCompletedSessionInsightsRepository(store);

    await expect(repository.loadInsights("missing")).resolves.toBeNull();
    expect(store.loadEarlierCompletedSessions).not.toHaveBeenCalled();
    expect(store.loadSessionExercises).not.toHaveBeenCalled();
  });

  it("assembles target and historical graphs before applying the shared PR calculation", async () => {
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
    });
    const repository = createCompletedSessionInsightsRepository(store);

    const insights = await repository.loadInsights("target");

    expect(store.loadEarlierCompletedSessions).toHaveBeenCalledWith({
      completedAt: AT,
      targetSessionId: "target",
    });
    expect(insights).toEqual({
      muscleVolumeComparisons: [],
      personalRecords: [
        expect.objectContaining({
          exerciseDefinitionId: "bench",
          setId: "target-set",
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
