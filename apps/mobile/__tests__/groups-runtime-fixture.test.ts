import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

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
        :name==='sync_push'?{ ok: true }:{ entries: [{ member: { user_id: 'athlete' },value: 256.25,unit: 'kg_reps',
          performance: { reps: 5,weight_value: '102.5',source_load_input_mode: 'total_load' },certification: null }] };
      return { status: 200,body: JSON.stringify(body) };
    } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../.maestro/scripts/groups-counterparty.js'),'utf8'),context);
  expect(calls.map(call=>call.name)).toEqual(['group_competition_exercise_list','sync_push','group_competition_board']);
  expect(calls.at(-1)?.args).toEqual({ p_group_id: 'group',p_group_exercise_id: 'comparison',p_metric: 'volume',p_certified: false,p_cursor: null,p_limit: 10 });
  expect(calls.every(call=>call.headers['x-boga-group-contract']==='4' && call.headers['x-boga-sync-protocol']==='4')).toBe(true);
});

/** Mock the local tool boundary, then execute the real wrapper to prove it
 * marks an initially pending stack for the next baseline preflight's reset
 * (never resetting it itself), and leaves an already-active local stack
 * unmarked. No real stack or credential is accessed. */
describe('temporary local competition runtime',()=>{
  let directory: string;
  beforeEach(()=>{
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'boga-competition-runtime-test-'));
    fs.mkdirSync(path.join(directory,'supabase/scripts'),{ recursive: true });fs.mkdirSync(path.join(directory,'bin'));
    fs.copyFileSync(path.resolve(__dirname,'../../../supabase/scripts/with-local-group-competitions.sh'),path.join(directory,'supabase/scripts/runtime.sh'));
    // The mark text is the real one: the baseline preflight matches it exactly.
    const realCommon=fs.readFileSync(path.resolve(__dirname,'../../../supabase/scripts/_common.sh'),'utf8');
    fs.writeFileSync(path.join(directory,'supabase/scripts/_common.sh'),[
      realCommon.match(/^PROTOCOL4_ACTIVATION_MARK=.*$/m)?.[0] ?? '',
      'REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"',
      'load_supabase_status_env() { API_URL=http://127.0.0.1:1234; ANON_KEY=fixture; SERVICE_ROLE_KEY=fixture; }',
      'resolve_db_container() { printf "fixture-db"; }',
      'mark_stack_needs_reset() { printf "mark %s\\n" "$1" >> "$FIXTURE_LOG"; }',
    ].join('\n'));
    fs.writeFileSync(path.join(directory,'boga'),'#!/bin/bash\nprintf "reset\\n" >> "$FIXTURE_LOG"\n');
    fs.chmodSync(path.join(directory,'boga'),0o755);
    fs.writeFileSync(path.join(directory,'bin/docker'),'#!/bin/bash\nprintf "%s" "$FIXTURE_ACTIVE"\n');fs.chmodSync(path.join(directory,'bin/docker'),0o755);
    fs.writeFileSync(path.join(directory,'bin/curl'),[
      '#!/bin/bash','while [[ $# -gt 0 ]]; do if [[ "$1" == -o ]]; then printf \'{"contract_version":4}\' > "$2"; shift; fi; shift; done',
      'printf "%s" "$FIXTURE_HTTP"',
    ].join('\n'));fs.chmodSync(path.join(directory,'bin/curl'),0o755);
  });
  afterEach(()=>fs.rmSync(directory,{ recursive: true,force: true }));
  const run=(active: string,http: string,commandStatus: number)=>spawnSync('/bin/bash',[
    path.join(directory,'supabase/scripts/runtime.sh'),'/bin/bash','-c',`exit ${commandStatus}`,
  ],{ env: { ...process.env,PATH: `${directory}/bin:${process.env.PATH}`,FIXTURE_ACTIVE: active,FIXTURE_HTTP: http,
    FIXTURE_LOG: `${directory}/cleanup.log` },encoding: 'utf8' });
  const marked='mark with-local-group-competitions.sh activated protocol 4\n';
  it('marks an initially pending local stack, never resets it, and preserves a failed command status',()=>{
    expect(run('f','200',7).status).toBe(7);expect(fs.readFileSync(`${directory}/cleanup.log`,'utf8')).toBe(marked);
  });
  it('neither marks nor resets an already-active local stack',()=>{
    expect(run('t','200',0).status).toBe(0);expect(fs.existsSync(`${directory}/cleanup.log`)).toBe(false);
  });
  it('marks the stack before an unsuccessful activation and does not run the command',()=>{
    const result=run('f','503',7);expect(result.status).toBe(1);expect(result.stderr).toContain('local activation failed');
    expect(fs.readFileSync(`${directory}/cleanup.log`,'utf8')).toBe(marked);
  });
});
