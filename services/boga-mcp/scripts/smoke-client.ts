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

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expectedNames = [
    'get_exercise_context',
    'get_recent_workouts',
    'get_training_profile',
    'search_exercises',
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
  if (process.env.BOGA_MCP_SMOKE_EXPECT_BODYWEIGHT === '1') {
    const performance = Array.isArray(context.recent_performances) ? context.recent_performances[0] : null;
    const set = isObject(performance) && Array.isArray(performance.sets) ? performance.sets[0] : null;
    const workout = workoutRows.find(row => isObject(row) && row.id === expectedSessionId);
    if (context.metric_revision !== 'bodyweight_optional_v1' || !isObject(performance) ||
      !isObject(performance.volume) || performance.volume.value !== 800 || performance.volume.complete !== true ||
      !isObject(performance.session_body_weight) || performance.session_body_weight.value !== 80 ||
      !isObject(set) || !isObject(set.load) || set.load.value !== 20 ||
      !isObject(set.calculated_load) || set.calculated_load.value !== 100 ||
      !isObject(workout) || !isObject(workout.total_volume) || workout.total_volume.value !== 800) {
      throw new Error('Bodyweight context or volume changed across the real OAuth-to-MCP path.');
    }
  }
} finally {
  await client.close();
}

console.log('[boga-mcp-smoke] PASS: four tools discovered and called through the real agent API');
