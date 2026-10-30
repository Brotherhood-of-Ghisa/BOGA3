import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run the repository workflow module in Node, as actions/github-script does.
const script = resolve(__dirname, '../../../scripts/publish-daily-development-log.cjs');
const run = (source: string) => JSON.parse(execFileSync(process.execPath, ['-e', `
  const { buildEntry, findCheckpoint, publish, automaticPostDue } = require(${JSON.stringify(script)});
  const repo = { owner: 'test', repo: 'boga' };
  ${source}
`], { encoding: 'utf8' }));

describe('daily development log', () => {
  it('formats achievements with PR/commit links and literal, non-pinging titles', () => {
    const body = run(`console.log(JSON.stringify(buildEntry(
      'a'.repeat(40) + '\\tfeat(timer): Add rest defaults (#916)\\n' +
      'b'.repeat(40) + '\\tfix: Keep [links] <safe> @reader', 'c'.repeat(40), repo,
      new Date('2026-07-01T23:30:00Z'))));`);
    expect(body).toContain('2 July 2026');
    expect(body).toContain('00:30');
    expect(body).toContain('- Add rest defaults ([#916](https://github.com/test/boga/pull/916))');
    expect(body).toContain('Keep \\[links\\] &lt;safe&gt; @\u200breader');
    expect(body).toContain('/commit/' + 'b'.repeat(40));
    expect(body).toContain('<!-- boga-daily-log: ' + 'c'.repeat(40) + ' -->');
  });

  it('finds the latest trusted checkpoint across comment pages', () => {
    expect(run(`
      let calls = 0;
      const github = { graphql: async () => ({ repository: { discussion: {
        id: 'discussion', comments: {
          nodes: calls++ === 0
            ? [{ body: '<!-- boga-daily-log: ' + 'f'.repeat(40) + ' -->', author: { login: 'reader' } }]
            : [{ body: '<!-- boga-daily-log: ' + 'a'.repeat(40) + ' -->', createdAt: '2026-10-27T08:00:00Z', author: { login: 'github-actions' } }],
          pageInfo: { hasPreviousPage: calls === 1, startCursor: 'previous' }
        }
      } } }) };
      findCheckpoint(github, repo).then(value => console.log(JSON.stringify({ value, calls })));
    `)).toEqual({ value: { id: 'discussion', sha: 'a'.repeat(40), createdAt: '2026-10-27T08:00:00Z' }, calls: 2 });
  });

  it.each([
    [null, '2026-10-28T07:29:59Z', false],
    [null, '2026-10-28T07:30:00Z', true],
    ['2026-10-27T08:00:00Z', '2026-10-28T08:00:00Z', true],
    ['2026-10-28T07:30:00Z', '2026-10-28T22:00:00Z', false],
    [null, '2026-07-01T06:29:59Z', false],
    [null, '2026-07-01T06:30:00Z', true],
    ['2026-06-30T23:15:00Z', '2026-07-01T06:30:00Z', false],
    ['2026-10-24T06:30:00Z', '2026-10-25T07:30:00Z', true],
  ])('uses London day and 07:30 boundary (%s, %s)', (previous, now, expected) => {
    expect(run(`console.log(JSON.stringify(automaticPostDue(
      ${JSON.stringify(previous)}, new Date(${JSON.stringify(now)}))));`)).toBe(expected);
  });

  it('recovers missing commits once daily, retries failed posts, and allows manual recovery', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'boga-daily-log-'));
    try {
      const result = run(`
        process.chdir(${JSON.stringify(fixture)});
        const { execFileSync } = require('node:child_process');
        const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
        git('init', '-q');
        git('config', 'user.name', 'Test');
        git('config', 'user.email', 'test@example.invalid');
        const commit = title => { git('commit', '-q', '--allow-empty', '-m', title); return git('rev-parse', 'HEAD'); };
        const baseline = commit('Initial');
        git('checkout', '-qb', 'feature');
        commit('WIP should not be listed');
        git('checkout', '-');
        git('merge', '-q', '--no-ff', 'feature', '-m', 'feat: Add timer (#1)');
        let now = new Date('2026-10-28T07:30:00Z');
        let comments = [{ body: '<!-- boga-daily-log: ' + baseline + ' -->', createdAt: '2026-10-27T08:00:00Z', author: { login: 'bozothegrey' } }];
        const posts = [];
        let fail = true;
        const github = { graphql: async (query, variables) => {
          if (query.includes('addDiscussionComment')) {
            if (fail) throw new Error('API failed');
            posts.push(variables.body);
            comments.push({ body: variables.body, createdAt: now.toISOString(), author: { login: 'github-actions' } });
            return { addDiscussionComment: { comment: { url: 'posted' } } };
          }
          return { repository: { discussion: { id: 'discussion', comments: {
            nodes: comments, pageInfo: { hasPreviousPage: false }
          } } } };
        } };
        (async () => {
          const args = { github, context: { repo, eventName: 'push' }, core: { info() {} }, now };
          let failed = false;
          try { await publish(args); } catch { failed = true; }
          fail = false;
          await publish(args);
          commit('feat: Later change (#2)');
          await publish(args);
          now = args.now = new Date('2026-10-29T07:29:00Z');
          await publish(args);
          now = args.now = new Date('2026-10-29T07:30:00Z');
          args.context.eventName = 'schedule';
          await publish(args);
          await publish(args);
          commit('fix: Manual recovery (#3)');
          args.context.eventName = 'workflow_dispatch';
          await publish(args);
          await publish(args);
          console.log(JSON.stringify({ failed, posts }));
        })();
      `);
      expect(result.failed).toBe(true);
      expect(result.posts).toHaveLength(3);
      expect(result.posts[0]).toContain('Add timer');
      expect(result.posts[0]).not.toContain('WIP');
      expect(result.posts[0]).not.toContain('- Initial');
      expect(result.posts[0]).not.toContain('Later change');
      expect(result.posts[1]).toContain('Later change');
      expect(result.posts[1]).not.toContain('Add timer');
      expect(result.posts[1]).toContain('29 October 2026');
      expect(result.posts[2]).toContain('Manual recovery');
      expect(result.posts[2]).not.toContain('Later change');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('stays quiet with no changes', () => {
    expect(run(`console.log(JSON.stringify(buildEntry('', 'a'.repeat(40), repo)));`)).toBeNull();
  });
});
