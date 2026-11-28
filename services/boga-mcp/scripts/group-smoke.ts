import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Group predictions need no app switch. With its own OAuth client (so its own
// agent API request window), list the seeded group, post one offer and see it
// on the board: the post-to-board round trip of the six prediction tools.
const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const endpoint = new URL(required('BOGA_MCP_SMOKE_URL'));
const accessToken = required('BOGA_MCP_SMOKE_ACCESS_TOKEN');
const groupId = required('BOGA_MCP_SMOKE_GROUP_ID');
const userId = required('BOGA_MCP_SMOKE_USER_ID');
if (!['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
  throw new Error('Group smoke writes require the seeded local fixture.');
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const client = new Client({ name: 'boga-group-smoke', version: '1.0.0' });
const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError || !object(result.structuredContent)) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  return result.structuredContent;
};

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  }));
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of ['list_prediction_groups', 'get_group_form', 'get_prediction_board',
    'post_prediction_offer', 'withdraw_prediction_offer', 'schedule_group_cow']) {
    if (!names.includes(name)) throw new Error(`Missing prediction tool ${name}.`);
  }

  const groups = await call('list_prediction_groups', {});
  const listed = Array.isArray(groups.groups)
    ? groups.groups.find((row) => object(row) && row.group_id === groupId) : undefined;
  const week = object(listed) && object(listed.open_week) ? listed.open_week.week_start : undefined;
  if (!object(listed) || typeof week !== 'string') {
    throw new Error('list_prediction_groups did not list the seeded group with an open week.');
  }
  const posted = await call('post_prediction_offer', {
    group_id: groupId, idempotency_key: `smoke-prediction-${Date.now()}`,
    parameters: { line: 5, member_user_id: userId }, price: 55, side: 'yes', stake: 5,
    template: 'sets_line', week_start: week,
  });
  const offer = object(posted.offer) ? posted.offer : {};
  const board = await call('get_prediction_board', { group_id: groupId });
  const mine = object(board.mine) && Array.isArray(board.mine.offers) ? board.mine.offers : [];
  if (typeof offer.offer_id !== 'string' || !mine.some((row) => object(row) && row.offer_id === offer.offer_id)) {
    throw new Error('The posted offer is not on the prediction board.');
  }
  if (JSON.stringify(board).includes('"note"')) throw new Error('The prediction board returned a note.');
  console.log('[boga-mcp-smoke] PASS: six prediction tools discovered; offer posted and read back from the board');
} finally {
  await client.close();
}
