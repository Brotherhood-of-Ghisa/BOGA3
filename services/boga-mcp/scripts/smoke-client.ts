import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

const endpoint = new URL(required('BOGA_MCP_SMOKE_URL'));
const accessToken = required('BOGA_MCP_SMOKE_ACCESS_TOKEN');
const expectedExerciseId = required('BOGA_MCP_SMOKE_EXERCISE_ID');
const expectedSessionId = required('BOGA_MCP_SMOKE_SESSION_ID');
const exerciseQuery = required('BOGA_MCP_SMOKE_EXERCISE_QUERY');
// Set only for the seeded local fixture: exercise writes never run against a
// supplied (possibly hosted) token.
const smokeMuscleId = process.env.BOGA_MCP_SMOKE_MUSCLE_ID?.trim() ?? '';
// Seeded beside it with report_group `mcp_smoke_group` and tracked 0.
const smokeGroupedMuscleId = process.env.BOGA_MCP_SMOKE_GROUPED_MUSCLE_ID?.trim() ?? '';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const structured = (
  result: Awaited<ReturnType<Client['callTool']>>,
  toolName: string,
): Record<string, unknown> => {
  if (result.isError || !isObject(result.structuredContent)) {
    throw new Error(`${toolName} returned an error or invalid structured content.`);
  }
  return result.structuredContent;
};

const client = new Client({
  name: 'boga-local-smoke',
  version: '1.0.0',
});
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  },
});

// A rejected token must produce a challenge (not a 500) so remote clients
// refresh or re-authorize instead of reporting the server as broken.
const assertRejectedTokenIsChallenged = async (): Promise<void> => {
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'boga-local-smoke', version: '1.0.0' },
        protocolVersion: '2025-11-25',
      },
    }),
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer revoked.or.expired.token',
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  const challenge = response.headers.get('www-authenticate') ?? '';
  if (response.status !== 401 || !challenge.includes('resource_metadata=')) {
    throw new Error(`A rejected token returned ${response.status} without an OAuth challenge.`);
  }
};

try {
  await assertRejectedTokenIsChallenged();
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expectedNames = [
    'create_exercise',
    'create_session_plan',
    'create_training_programme',
    'delete_exercise',
    'get_exercise_context',
    'get_exercise_history',
    'get_recent_workouts',
    'get_training_profile',
    'get_training_status',
    'get_upcoming_session_plans',
    'get_workout_detail',
    'list_muscles',
    'restore_exercise',
    'search_exercises',
    'set_muscle_targets',
    'update_exercise',
  ];
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Unexpected MCP tools: ${names.join(', ')}`);
  }

  const profile = structured(
    await client.callTool({ arguments: {}, name: 'get_training_profile' }),
    'get_training_profile',
  );
  if (
    JSON.stringify(profile).toLowerCase().includes('email') ||
    JSON.stringify(profile).toLowerCase().includes('billing')
  ) {
    throw new Error('Training profile contains unrelated account data.');
  }

  const search = structured(
    await client.callTool({
      arguments: { limit: 10, query: exerciseQuery },
      name: 'search_exercises',
    }),
    'search_exercises',
  );
  const exercises = Array.isArray(search.exercises) ? search.exercises : [];
  if (
    !exercises.some((exercise) =>
      isObject(exercise) && exercise.id === expectedExerciseId
    )
  ) {
    throw new Error('Exercise search did not return the test user exercise.');
  }

  const context = structured(
    await client.callTool({
      arguments: { exercise_id: expectedExerciseId, recent_sessions: 5 },
      name: 'get_exercise_context',
    }),
    'get_exercise_context',
  );
  if (!isObject(context.exercise) || context.exercise.id !== expectedExerciseId) {
    throw new Error('Exercise context returned the wrong exercise.');
  }

  const workouts = structured(
    await client.callTool({ arguments: { limit: 5 }, name: 'get_recent_workouts' }),
    'get_recent_workouts',
  );
  const workoutRows = Array.isArray(workouts.workouts) ? workouts.workouts : [];
  if (
    !workoutRows.some((workout) =>
      isObject(workout) && workout.id === expectedSessionId
    )
  ) {
    throw new Error('Recent workouts did not return the test user session.');
  }

  // One bounded status: the seeded exercise is a favourite of the last 28 days.
  const trainingStatus = structured(
    await client.callTool({ arguments: {}, name: 'get_training_status' }),
    'get_training_status',
  );
  const favourites = Array.isArray(trainingStatus.favourite_exercises) ? trainingStatus.favourite_exercises : [];
  if (
    trainingStatus.metric_revision !== 'working_sets_v8' ||
    !Array.isArray(trainingStatus.muscles) ||
    !isObject(trainingStatus.targets) ||
    typeof trainingStatus.complete !== 'boolean' ||
    !favourites.some((favourite) =>
      isObject(favourite) && favourite.exercise_id === expectedExerciseId &&
      typeof favourite.sessions_28d === 'number' && favourite.sessions_28d >= 1
    )
  ) {
    throw new Error('Training status did not return the bounded shape with the test exercise as a favourite.');
  }

  // Drain exact exercise history across pages
  const historyPage1 = structured(
    await client.callTool({
      arguments: { exercise_id: expectedExerciseId, limit: 1 },
      name: 'get_exercise_history',
    }),
    'get_exercise_history page 1',
  );
  const setsPage1 = Array.isArray(historyPage1.sets) ? historyPage1.sets : [];
  if (setsPage1.length !== 1 || !historyPage1.next_cursor) {
    throw new Error('Exercise history page 1 did not return exactly 1 set with next_cursor.');
  }
  const historyPage2 = structured(
    await client.callTool({
      arguments: {
        cursor: String(historyPage1.next_cursor),
        exercise_id: expectedExerciseId,
        limit: 1,
      },
      name: 'get_exercise_history',
    }),
    'get_exercise_history page 2',
  );
  const setsPage2 = Array.isArray(historyPage2.sets) ? historyPage2.sets : [];
  if (setsPage2.length !== 1) {
    throw new Error('Exercise history page 2 did not return the second set.');
  }
  if ((setsPage1[0] as any).id === (setsPage2[0] as any).id) {
    throw new Error('Exercise history repeated the first set across pages.');
  }

  // Drain exact completed workout detail
  const workoutPage1 = structured(
    await client.callTool({
      arguments: { limit: 1, session_id: expectedSessionId },
      name: 'get_workout_detail',
    }),
    'get_workout_detail page 1',
  );
  const detailWorkout = isObject(workoutPage1.workout) ? workoutPage1.workout : null;
  const detailSets1 = detailWorkout && Array.isArray(detailWorkout.sets) ? detailWorkout.sets : [];
  if (!detailWorkout || detailSets1.length !== 1 || !detailWorkout.next_cursor) {
    throw new Error('Workout detail page 1 did not return expected workout with cursor.');
  }
  const workoutPage2 = structured(
    await client.callTool({
      arguments: {
        cursor: String(detailWorkout.next_cursor),
        limit: 1,
        session_id: expectedSessionId,
      },
      name: 'get_workout_detail',
    }),
    'get_workout_detail page 2',
  );
  const detailWorkout2 = isObject(workoutPage2.workout) ? workoutPage2.workout : null;
  const detailSets2 = detailWorkout2 && Array.isArray(detailWorkout2.sets) ? detailWorkout2.sets : [];
  if (!detailWorkout2 || detailSets2.length !== 1) {
    throw new Error('Workout detail page 2 did not return the second set.');
  }

  // Planning tools: when permission is disabled, plan tools MUST fail with PLAN_PERMISSION_REQUIRED
  const planPermissionEnabled = process.env.BOGA_MCP_SMOKE_PLAN_ENABLED === '1';
  if (!planPermissionEnabled) {
    const unauthPlan = await client.callTool({
      arguments: {
        idempotency_key: 'denied-plan-key',
        plan: {
          exercises: [{ name: 'Bench', sets: [{ target_reps: 5 }] }],
          title: 'Unauthorized plan',
        },
      },
      name: 'create_session_plan',
    });
    if (!unauthPlan.isError || !JSON.stringify(unauthPlan).includes('PLAN_PERMISSION_REQUIRED')) {
      throw new Error('create_session_plan succeeded or failed without PLAN_PERMISSION_REQUIRED when disabled.');
    }

    const unauthRead = await client.callTool({
      arguments: {},
      name: 'get_upcoming_session_plans',
    });
    if (!unauthRead.isError || !JSON.stringify(unauthRead).includes('PLAN_PERMISSION_REQUIRED')) {
      throw new Error('get_upcoming_session_plans succeeded or failed without PLAN_PERMISSION_REQUIRED when disabled.');
    }

    if (smokeMuscleId) {
      const unauthExercise = await client.callTool({
        arguments: {
          exercise: { muscles: [{ muscle_id: smokeMuscleId, role: 'primary' }], name: `${exerciseQuery} Denied` },
          idempotency_key: `smoke-ex-denied-${Date.now()}`,
        },
        name: 'create_exercise',
      });
      if (!unauthExercise.isError || !JSON.stringify(unauthExercise).includes('PLAN_PERMISSION_REQUIRED')) {
        throw new Error('create_exercise succeeded or failed without PLAN_PERMISSION_REQUIRED when disabled.');
      }

      const unauthTargets = await client.callTool({
        arguments: { default_weekly_sets: 12, expected_revision: 0, idempotency_key: `smoke-targets-denied-${Date.now()}` },
        name: 'set_muscle_targets',
      });
      if (!unauthTargets.isError || !JSON.stringify(unauthTargets).includes('PLAN_PERMISSION_REQUIRED')) {
        throw new Error('set_muscle_targets succeeded or failed without PLAN_PERMISSION_REQUIRED when disabled.');
      }
    }
  } else {
    // Planning permission is enabled: test create_session_plan, create_training_programme, idempotency replay/conflict, and read
    const planKey = `smoke-plan-key-${Date.now()}`;
    const planPayload = {
      idempotency_key: planKey,
      plan: {
        exercises: [
          {
            exercise_definition_id: expectedExerciseId,
            name: 'Bench Press',
            sets: [
              { target_reps: 5, target_set_type: 'rir_2', target_weight_value: '80' },
              { target_reps: 8 },
            ],
          },
        ],
        scheduled_for: Date.now() + 86400000,
        title: 'Smoke Test Plan',
      },
    };
    const createdPlan = structured(
      await client.callTool({
        arguments: planPayload,
        name: 'create_session_plan',
      }),
      'create_session_plan',
    );
    const planId = String(createdPlan.plan_id ?? '');
    if (!planId || createdPlan.idempotent_replay !== false) {
      throw new Error('create_session_plan failed to return new plan_id or had incorrect replay flag.');
    }

    // Replay with exact same payload and key: returns same plan_id with idempotent_replay: true
    const replayedPlan = structured(
      await client.callTool({
        arguments: planPayload,
        name: 'create_session_plan',
      }),
      'create_session_plan replay',
    );
    if (replayedPlan.plan_id !== planId || replayedPlan.idempotent_replay !== true) {
      throw new Error('Idempotent replay did not return matching plan_id and true flag.');
    }

    // Conflict: same key, different payload -> IDEMPOTENCY_CONFLICT
    const conflictResult = await client.callTool({
      arguments: {
        idempotency_key: planKey,
        plan: {
          exercises: [{ name: 'Bench Press', sets: [{ target_reps: 10 }] }],
          title: 'Different Title',
        },
      },
      name: 'create_session_plan',
    });
    if (!conflictResult.isError || !JSON.stringify(conflictResult).includes('IDEMPOTENCY_CONFLICT')) {
      throw new Error('Conflicting idempotency key did not produce IDEMPOTENCY_CONFLICT.');
    }

    // Create a multi-session programme
    const progKey = `smoke-prog-key-${Date.now()}`;
    const createdProgramme = structured(
      await client.callTool({
        arguments: {
          idempotency_key: progKey,
          programme: {
            description: 'Two week split',
            name: 'Smoke Programme',
            plans: [
              {
                exercises: [{ name: 'Day 1', sets: [{ target_reps: 5 }] }],
                title: 'Week 1 Day 1',
              },
              {
                exercises: [{ name: 'Day 2', sets: [{ target_reps: 6 }] }],
                title: 'Week 1 Day 2',
              },
            ],
          },
        },
        name: 'create_training_programme',
      }),
      'create_training_programme',
    );
    const progId = String(createdProgramme.programme_id ?? '');
    const progPlanIds = Array.isArray(createdProgramme.plan_ids) ? createdProgramme.plan_ids : [];
    if (!progId || progPlanIds.length !== 2) {
      throw new Error('create_training_programme failed to emit programme_id and two plan_ids.');
    }

    // Read upcoming session plans
    const upcoming = structured(
      await client.callTool({
        arguments: { include_unscheduled: true },
        name: 'get_upcoming_session_plans',
      }),
      'get_upcoming_session_plans',
    );
    const plansList = Array.isArray(upcoming.plans) ? upcoming.plans : [];
    if (!plansList.some((p) => isObject(p) && p.id === planId && p.provenance === 'agent')) {
      throw new Error('get_upcoming_session_plans did not return the agent-created plan.');
    }

    if (smokeMuscleId) {
      const muscles = structured(
        await client.callTool({ arguments: {}, name: 'list_muscles' }),
        'list_muscles',
      );
      const muscleList = Array.isArray(muscles.muscles) ? muscles.muscles : [];
      if (!muscleList.some((m) => isObject(m) && m.id === smokeMuscleId)) {
        throw new Error('list_muscles did not return the seeded muscle.');
      }
      if (!muscleList.every((m) => isObject(m) && 'report_group' in m && typeof m.tracked === 'boolean')) {
        throw new Error('list_muscles did not return each muscle’s report_group and tracked state.');
      }
      const own = muscleList.find((m) => isObject(m) && m.id === smokeMuscleId);
      if (!isObject(own) || own.report_group !== null || own.tracked !== true) {
        throw new Error('list_muscles did not report the seeded muscle as its own, tracked muscle.');
      }
      if (smokeGroupedMuscleId) {
        const grouped = muscleList.find((m) => isObject(m) && m.id === smokeGroupedMuscleId);
        if (!isObject(grouped) || grouped.report_group !== 'mcp_smoke_group' || grouped.tracked !== false) {
          throw new Error('list_muscles did not return the stored report_group and tracked = false of the grouped muscle.');
        }
      }

      const coPrimaries = [smokeMuscleId, ...(smokeGroupedMuscleId ? [smokeGroupedMuscleId] : [])]
        .map((muscle_id) => ({ muscle_id, role: 'primary' }));
      const created = structured(
        await client.callTool({
          arguments: {
            exercise: {
              muscles: coPrimaries,
              name: `${exerciseQuery} Created`,
              split_by_gym: true,
            },
            idempotency_key: `smoke-ex-create-${Date.now()}`,
          },
          name: 'create_exercise',
        }),
        'create_exercise',
      );
      const createdId = String(created.exercise_id ?? '');
      if (!createdId || !isObject(created.exercise) || created.exercise.split_by_gym !== true ||
        !Array.isArray(created.exercise.muscles) || created.exercise.muscles.length !== coPrimaries.length ||
        !created.exercise.muscles.every((m) => isObject(m) && m.role === 'primary' && m.weight === 1)) {
        throw new Error('create_exercise did not return the created per-gym exercise.');
      }

      const updated = structured(
        await client.callTool({
          arguments: {
            changes: { muscles: coPrimaries, split_by_gym: false },
            exercise_id: createdId,
            expected_revision: Number(created.revision),
            idempotency_key: `smoke-ex-update-${Date.now()}`,
          },
          name: 'update_exercise',
        }),
        'update_exercise',
      );
      if (!isObject(updated.exercise) || updated.exercise.split_by_gym !== false ||
        !Array.isArray(updated.exercise.muscles) || updated.exercise.muscles.length !== coPrimaries.length ||
        !updated.exercise.muscles.every((m) => isObject(m) && m.role === 'primary' && m.weight === 1)) {
        throw new Error('update_exercise did not apply the change.');
      }

      const stale = await client.callTool({
        arguments: {
          changes: { name: `${exerciseQuery} Stale` },
          exercise_id: createdId,
          expected_revision: Number(created.revision),
          idempotency_key: `smoke-ex-stale-${Date.now()}`,
        },
        name: 'update_exercise',
      });
      if (!stale.isError || !JSON.stringify(stale).includes('REVISION_CONFLICT')) {
        throw new Error('A stale update_exercise revision did not fail with REVISION_CONFLICT.');
      }

      const deleted = structured(
        await client.callTool({
          arguments: {
            exercise_id: createdId,
            expected_revision: Number(updated.revision),
            idempotency_key: `smoke-ex-delete-${Date.now()}`,
          },
          name: 'delete_exercise',
        }),
        'delete_exercise',
      );
      const restored = structured(
        await client.callTool({
          arguments: {
            exercise_id: createdId,
            expected_revision: Number(deleted.revision),
            idempotency_key: `smoke-ex-restore-${Date.now()}`,
          },
          name: 'restore_exercise',
        }),
        'restore_exercise',
      );
      if (deleted.deleted !== true || restored.deleted !== false) {
        throw new Error('delete_exercise / restore_exercise did not round-trip.');
      }

      // The coach's targets: set, replay, stale, foreign id, then the status shows them.
      const before = isObject(trainingStatus.targets) ? trainingStatus.targets : {};
      const targetsArguments = {
        default_weekly_sets: 11,
        expected_revision: Number(before.revision),
        idempotency_key: `smoke-targets-${Date.now()}`,
        mode: 'per_muscle',
        overrides: { [smokeMuscleId]: 14 },
      };
      const targets = structured(
        await client.callTool({ arguments: targetsArguments, name: 'set_muscle_targets' }),
        'set_muscle_targets',
      );
      const replayed = structured(
        await client.callTool({ arguments: targetsArguments, name: 'set_muscle_targets' }),
        'set_muscle_targets replay',
      );
      const newTargets = isObject(targets.targets) ? targets.targets : {};
      if (
        newTargets.default_weekly_sets !== 11 || newTargets.mode !== 'per_muscle' ||
        !(Number(newTargets.revision) > Number(before.revision)) ||
        !isObject(targets.overrides) || targets.overrides[smokeMuscleId] !== 14 ||
        targets.idempotent_replay !== false || replayed.idempotent_replay !== true
      ) {
        throw new Error('set_muscle_targets did not apply, or its replay did not return the first result.');
      }
      const staleTargets = await client.callTool({
        arguments: { ...targetsArguments, default_weekly_sets: 9, idempotency_key: `smoke-targets-stale-${Date.now()}` },
        name: 'set_muscle_targets',
      });
      if (!staleTargets.isError || !JSON.stringify(staleTargets).includes('REVISION_CONFLICT')) {
        throw new Error('A stale set_muscle_targets revision did not fail with REVISION_CONFLICT.');
      }
      const foreignTargets = await client.callTool({
        arguments: {
          expected_revision: Number(newTargets.revision),
          idempotency_key: `smoke-targets-foreign-${Date.now()}`,
          overrides: { [`${smokeMuscleId}-missing`]: 9 },
        },
        name: 'set_muscle_targets',
      });
      if (!foreignTargets.isError || !JSON.stringify(foreignTargets).includes('VALIDATION_ERROR')) {
        throw new Error('set_muscle_targets accepted an override for a muscle outside the setup.');
      }
      const after = structured(
        await client.callTool({ arguments: {}, name: 'get_training_status' }),
        'get_training_status after set_muscle_targets',
      );
      const afterMuscle = Array.isArray(after.muscles)
        ? after.muscles.find((muscle) => isObject(muscle) && muscle.id === smokeMuscleId)
        : null;
      if (
        !isObject(after.targets) || after.targets.default_weekly_sets !== 11 ||
        after.targets.mode !== 'per_muscle' || after.targets.uploaded !== true ||
        after.targets.revision !== newTargets.revision ||
        !isObject(afterMuscle) || afterMuscle.weekly_target !== 14
      ) {
        throw new Error('get_training_status did not show the targets the coach set.');
      }
    }
  }

  if (process.env.BOGA_MCP_SMOKE_EXPECT_BODYWEIGHT === '1') {
    const performance = Array.isArray(context.recent_performances) ? context.recent_performances[0] : null;
    const sets = isObject(performance) && Array.isArray(performance.sets) ? performance.sets : [];
    const set = sets[0];
    const warmUp = sets[1];
    const workout = workoutRows.find(row => isObject(row) && row.id === expectedSessionId);
    // The seeded warm-up is listed with its set_type but feeds no volume or count.
    if (context.metric_revision !== 'working_sets_v8' || !isObject(performance) ||
      sets.length !== 2 || !isObject(warmUp) || warmUp.set_type !== 'warm_up' ||
      !isObject(performance.volume) || performance.volume.value !== 800 || performance.volume.complete !== true ||
      !isObject(performance.session_body_weight) || performance.session_body_weight.value !== 80 ||
      !isObject(set) || !isObject(set.load) || set.load.value !== 20 ||
      !isObject(set.calculated_load) || set.calculated_load.value !== 100 ||
      !isObject(workout) || !isObject(workout.total_volume) || workout.total_volume.value !== 800 ||
      workout.completed_set_count !== 1) {
      throw new Error('Bodyweight context, working-set volume or counts changed across the real OAuth-to-MCP path.');
    }
  }
} finally {
  await client.close();
}

console.log('[boga-mcp-smoke] PASS: rejected token challenged; sixteen tools discovered and verified');

