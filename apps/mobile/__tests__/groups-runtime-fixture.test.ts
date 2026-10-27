import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/** Execute the fixture itself: its client must negotiate the same safe reader
 * and single-set Volume contract as the device, with no legacy RPC fallback. */
it('the scripted counterparty links and polls protocol-4 single-set Volume',()=>{
  const calls: { name: string;args: Record<string,unknown>;headers: Record<string,string> }[]=[];
  const output={ groupsAnonKey: 'anon',groupsSupabaseUrl: 'http://127.0.0.1:1234',groupsToken: 'fixture',
    groupsGroupId: 'group',groupsSessionId: 'session',groupsCounterpartyUserId: 'athlete' };
  const context={ STEP: 'link-board',output,Date,Math,JSON,console: { log: jest.fn() },json: JSON.parse,
    http: { post: (url: string,options: { headers: Record<string,string>;body: string })=>{
      const name=url.split('/').at(-1)!;calls.push({ name,args: JSON.parse(options.body),headers: options.headers });
      const body=name==='group_competition_exercise_list'?{ exercises: [{ name: 'Sled Push',archived_at_ms: null,group_exercise_id: 'comparison' }] }
        :name==='sync_push'?{ ok: true }:{ entries: [{ member: { user_id: 'athlete' },value: 512.5,unit: 'kg_reps',
          performance: { reps: 5,weight_value: '102.5',source_load_input_mode: 'total_load' },certification: null }] };
      return { status: 200,body: JSON.stringify(body) };
    } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../.maestro/scripts/groups-counterparty.js'),'utf8'),context);
  expect(calls.map(call=>call.name)).toEqual(['group_competition_exercise_list','sync_push','group_competition_board']);
  expect(calls.at(-1)?.args).toEqual({ p_group_id: 'group',p_group_exercise_id: 'comparison',p_metric: 'volume',p_certified: false,p_cursor: null,p_limit: 10 });
  expect(calls.every(call=>call.headers['x-boga-group-contract']==='4' && call.headers['x-boga-sync-protocol']==='5')).toBe(true);
});

it('the merge device fixture refuses remote writes and uses revision-aware app requests for every phase', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../.maestro/scripts/exercise-merge-device.js'), 'utf8');
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const output: Record<string, unknown> = {};
  let scriptedPhase = 'seed';
  const context = { STEP: 'seed', SUPABASE_URL: 'https://remote.example', SUPABASE_ANON_KEY: 'anon',
    EMAIL: 'fixture@example.test', PASSWORD: 'fixture', output, Date, Math, JSON, json: JSON.parse,
    http: { post: (url: string, options: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      const body = url.includes('/auth/') ? { access_token: 'fixture-token' } : url.endsWith('sync_push') ?
        { outcomes: [{ outcome: scriptedPhase === 'stale' ? 'preserved' : 'accepted' }] } : {
          rows: [{ id: (output.mergeSavedSet as { id: string }).id, fields: { weight_value: '25' } }],
        };
      return { status: 200, body: JSON.stringify(body) };
    } },
  };
  for (const url of ['https://remote.example', 'http://127.0.0.1:1234@remote.example']) {
    context.SUPABASE_URL = url;
    expect(() => vm.runInNewContext(script, context)).toThrow(/Local merge fixture required/);
    expect(calls).toHaveLength(0);
  }
  context.SUPABASE_URL = 'http://127.0.0.1:1234';
  for (const phase of ['seed', 'invalid', 'repair', 'stale', 'verify']) {
    scriptedPhase = phase; context.STEP = phase; vm.runInNewContext(script, context);
  }
  const rpc = calls.filter(call => !call.url.includes('/auth/'));
  expect(rpc).toHaveLength(5);
  expect(rpc.every(call => call.headers.Authorization === 'Bearer fixture-token' && call.headers['x-boga-sync-protocol'] === '5')).toBe(true);
});
