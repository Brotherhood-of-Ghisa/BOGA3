import { __privateSyncBootstrapForTests, fetchRemoteSyncProjectionState, flushSyncOutboxUntilSettled } from '@/src/sync';

type ProjectionStateInput = Parameters<typeof __privateSyncBootstrapForTests.buildMergePlan>[0]['local'];

const emptyState = (): ProjectionStateInput => ({
  gyms: [],
  sessions: [],
  sessionExercises: [],
  exerciseSets: [],
  exerciseDefinitions: [],
  exerciseMuscleMappings: [],
  exerciseTagDefinitions: [],
  sessionExerciseTags: [],
});

describe('sync bootstrap merge determinism', () => {
  it('deterministically keeps local winners and ignores remote tombstones for local-only entities', () => {
    const local = emptyState();
    const remote = emptyState();

    local.gyms.push({
      id: 'gym-local',
      name: 'Local Gym',
      deletedAtMs: null,
      latitude: 51.5072,
      longitude: -0.1276,
      coordinateAccuracyM: 12.5,
      coordinatesUpdatedAtMs: 8_500,
      createdAtMs: 1_000,
      updatedAtMs: 9_000,
    });

    remote.gyms.push(
      {
        id: 'gym-local',
        name: 'Remote Older Gym',
        deletedAtMs: null,
        latitude: null,
        longitude: null,
        coordinateAccuracyM: null,
        coordinatesUpdatedAtMs: null,
        createdAtMs: 1_000,
        updatedAtMs: 8_000,
      },
      {
        id: 'gym-remote',
        name: 'Remote Gym',
        deletedAtMs: null,
        latitude: 40.7128,
        longitude: -74.006,
        coordinateAccuracyM: 20,
        coordinatesUpdatedAtMs: 1_050,
        createdAtMs: 1_100,
        updatedAtMs: 1_100,
      },
      {
        id: 'gym-remote-deleted',
        name: 'Deleted Remote Gym',
        deletedAtMs: 2_000,
        latitude: null,
        longitude: null,
        coordinateAccuracyM: null,
        coordinatesUpdatedAtMs: null,
        createdAtMs: 1_200,
        updatedAtMs: 2_000,
      }
    );

    local.exerciseDefinitions.push({
      id: 'exercise-local',
      name: 'Local Exercise',
      deletedAtMs: null,
      createdAtMs: 1_000,
      updatedAtMs: 8_000,
    });

    remote.exerciseDefinitions.push(
      {
        id: 'exercise-local',
        name: 'Remote Older Exercise',
        deletedAtMs: null,
        createdAtMs: 1_000,
        updatedAtMs: 7_000,
      },
      {
        id: 'exercise-remote',
        name: 'Remote Exercise',
        deletedAtMs: null,
        createdAtMs: 2_000,
        updatedAtMs: 2_000,
      }
    );

    local.exerciseMuscleMappings.push({
      id: 'mapping-local',
      exerciseDefinitionId: 'exercise-local',
      muscleGroupId: 'pectorals',
      weight: 1,
      role: 'primary',
      createdAtMs: 3_000,
      updatedAtMs: 9_000,
    });

    remote.exerciseMuscleMappings.push(
      {
        id: 'mapping-remote-older',
        exerciseDefinitionId: 'exercise-local',
        muscleGroupId: 'pectorals',
        weight: 0.5,
        role: 'secondary',
        createdAtMs: 3_000,
        updatedAtMs: 8_000,
      },
      {
        id: 'mapping-remote',
        exerciseDefinitionId: 'exercise-remote',
        muscleGroupId: 'lats',
        weight: 0.8,
        role: 'primary',
        createdAtMs: 4_000,
        updatedAtMs: 4_000,
      }
    );

    const mergePlan = __privateSyncBootstrapForTests.buildMergePlan({
      local,
      remote,
    });

    expect(mergePlan.mergedState.gyms.map((row) => row.id)).toEqual(['gym-local', 'gym-remote']);
    expect(mergePlan.mergedState.gyms.find((row) => row.id === 'gym-local')?.name).toBe('Local Gym');
    expect(mergePlan.mergedState.gyms.find((row) => row.id === 'gym-local')).toEqual(
      expect.objectContaining({
        latitude: 51.5072,
        longitude: -0.1276,
        coordinateAccuracyM: 12.5,
        coordinatesUpdatedAtMs: 8_500,
      })
    );

    expect(mergePlan.mergedState.exerciseDefinitions.map((row) => row.id)).toEqual([
      'exercise-local',
      'exercise-remote',
    ]);

    expect(mergePlan.mergedState.exerciseMuscleMappings.map((row) => row.id)).toEqual([
      'mapping-local',
      'mapping-remote',
    ]);

    const convergenceEvents = __privateSyncBootstrapForTests.buildConvergenceEvents(
      mergePlan.localSelections
    );

    expect(convergenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'gyms',
          entityId: 'gym-local',
          eventType: 'upsert',
          payload: expect.objectContaining({
            latitude: 51.5072,
            longitude: -0.1276,
            coordinate_accuracy_m: 12.5,
            coordinates_updated_at_ms: 8_500,
          }),
        }),
        expect.objectContaining({
          entityType: 'exercise_definitions',
          entityId: 'exercise-local',
          eventType: 'upsert',
        }),
        expect.objectContaining({
          entityType: 'exercise_muscle_mappings',
          entityId: 'exercise-local:pectorals',
          eventType: 'attach',
        }),
      ])
    );
    expect(convergenceEvents.map((event) => event.entityType)).toEqual([
      'exercise_definitions',
      'exercise_muscle_mappings',
      'gyms',
    ]);

    expect(convergenceEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'gym-remote' }),
        expect.objectContaining({ entityId: 'exercise-remote:lats' }),
      ])
    );
  });

  it('flushes to convergence only when an idle terminal state is reached', async () => {
    const flush = jest
      .fn()
      .mockResolvedValueOnce({ status: 'success', sentCount: 3 })
      .mockResolvedValueOnce({ status: 'success', sentCount: 2 })
      .mockResolvedValueOnce({ status: 'idle' });

    const result = await flushSyncOutboxUntilSettled({
      flush,
      maxAttempts: 5,
    });

    expect(result.status).toBe('converged');
    expect(result.totalSentCount).toBe(5);
    expect(result.attempts).toBe(3);
    expect(result.lastFlushResult).toEqual({ status: 'idle' });

    const failureFlush = jest.fn().mockResolvedValue({
      status: 'failure_retry_scheduled',
      sentCount: 2,
      nextAttemptAt: new Date('2026-03-06T11:00:02.000Z'),
    });

    const failureResult = await flushSyncOutboxUntilSettled({
      flush: failureFlush,
      maxAttempts: 5,
    });

    expect(failureResult.status).toBe('not_converged');
    expect(failureResult.lastFlushResult.status).toBe('failure_retry_scheduled');
  });

  it('includes set_type in exercise_set convergence upserts', () => {
    const events = __privateSyncBootstrapForTests.buildConvergenceEvents({
      gyms: [],
      sessions: [],
      sessionExercises: [],
      exerciseSets: [
        {
          id: 'set-1',
          sessionExerciseId: 'sx-1',
          orderIndex: 0,
          weightValue: '100',
          repsValue: '5',
          setType: 'rir_2',
          deletedAtMs: null,
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
        },
      ],
      exerciseDefinitions: [],
      exerciseMuscleMappings: [],
      exerciseTagDefinitions: [],
      sessionExerciseTags: [],
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'exercise_sets',
          eventType: 'upsert',
          payload: expect.objectContaining({
            set_type: 'rir_2',
          }),
        }),
      ])
    );
  });

  it('falls back when remote exercise_sets.set_type column is unavailable', async () => {
    const exerciseSetRow = {
      id: 'set-legacy',
      session_exercise_id: 'sx-legacy',
      order_index: 0,
      weight_value: '80',
      reps_value: '12',
      deleted_at: null,
      created_at: 1_000,
      updated_at: 2_000,
    };
    const emptyRows: Record<string, unknown>[] = [];
    const gymRows = [
      {
        id: 'gym-remote-coordinate',
        name: 'Remote Coordinate Gym',
        latitude: '51.5072',
        longitude: '-0.1276',
        coordinate_accuracy_m: '12.5',
        coordinates_updated_at: '1772794800000',
        deleted_at: null,
        created_at: 1_000,
        updated_at: 2_000,
      },
    ];

    const selectCalls: string[] = [];
    const client = {
      schema: () => ({
        from: (table: string) => ({
          select: (columns: string) => {
            selectCalls.push(`${table}:${columns}`);

            if (table === 'exercise_sets' && columns.includes('set_type')) {
              return Promise.resolve({
                data: null,
                error: { message: 'column exercise_sets.set_type does not exist' },
              });
            }

            if (table === 'exercise_sets') {
              return Promise.resolve({
                data: [exerciseSetRow],
                error: null,
              });
            }

            const dataByTable: Record<string, Record<string, unknown>[]> = {
              gyms: gymRows,
              sessions: emptyRows,
              session_exercises: emptyRows,
              exercise_definitions: emptyRows,
              exercise_muscle_mappings: emptyRows,
              exercise_tag_definitions: emptyRows,
              session_exercise_tags: emptyRows,
            };
            return Promise.resolve({
              data: dataByTable[table] ?? emptyRows,
              error: null,
            });
          },
        }),
      }),
    };

    const remoteState = await fetchRemoteSyncProjectionState(client as never);
    expect(remoteState.gyms).toEqual([
      {
        id: 'gym-remote-coordinate',
        name: 'Remote Coordinate Gym',
        latitude: 51.5072,
        longitude: -0.1276,
        coordinateAccuracyM: 12.5,
        coordinatesUpdatedAtMs: 1772794800000,
        deletedAtMs: null,
        createdAtMs: 1_000,
        updatedAtMs: 2_000,
      },
    ]);
    expect(remoteState.exerciseSets).toEqual([
      {
        id: 'set-legacy',
        sessionExerciseId: 'sx-legacy',
        orderIndex: 0,
        weightValue: '80',
        repsValue: '12',
        setType: null,
        deletedAtMs: null,
        createdAtMs: 1_000,
        updatedAtMs: 2_000,
      },
    ]);
    expect(selectCalls).toContain(
      'gyms:id,name,latitude,longitude,coordinate_accuracy_m,coordinates_updated_at,deleted_at,created_at,updated_at'
    );
    expect(selectCalls).toContain(
      'exercise_sets:id,session_exercise_id,order_index,weight_value,reps_value,set_type,deleted_at,created_at,updated_at'
    );
    expect(selectCalls).toContain(
      'exercise_sets:id,session_exercise_id,order_index,weight_value,reps_value,deleted_at,created_at,updated_at'
    );
  });
});
