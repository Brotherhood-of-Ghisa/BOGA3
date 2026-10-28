const { execFileSync } = require('node:child_process');

const DISCUSSION_NUMBER = 920;
const MARKER = /<!-- boga-daily-log: ([a-f0-9]{40}) -->/;

async function findCheckpoint(github, repo) {
  let before = null;
  do {
    const { repository } = await github.graphql(`
      query($owner: String!, $repo: String!, $number: Int!, $before: String) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            id
            comments(last: 100, before: $before) {
              nodes { body author { login } }
              pageInfo { hasPreviousPage startCursor }
            }
          }
        }
      }`, { owner: repo.owner, repo: repo.repo, number: DISCUSSION_NUMBER, before });
    const discussion = repository.discussion;
    if (!discussion) throw new Error('Daily development log discussion not found');
    for (const comment of [...discussion.comments.nodes].reverse()) {
      // Readers can comment too; only trusted publishers may advance the cursor.
      if (!['github-actions', 'bozothegrey'].includes(comment.author?.login)) continue;
      const match = comment.body.match(MARKER);
      if (match) return { id: discussion.id, sha: match[1] };
    }
    if (!discussion.comments.pageInfo.hasPreviousPage) return { id: discussion.id, sha: null };
    before = discussion.comments.pageInfo.startCursor;
  } while (before);
}

function buildEntry(commits, head, repo, now = new Date()) {
  if (!commits.trim()) return null;
  const url = `https://github.com/${repo.owner}/${repo.repo}`;
  const bullets = commits.trim().split('\n').map((line) => {
    const [sha, ...parts] = line.split('\t');
    const subject = parts.join('\t').replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, '');
    const pr = subject.match(/\s*\(#(\d+)\)$/);
    const title = subject.replace(/\s*\(#\d+\)$/, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/([\\`*_[\]~])/g, '\\$1').replace(/@/g, '@\u200b');
    const link = pr ? `[#${pr[1]}](${url}/pull/${pr[1]})` : `[${sha.slice(0, 7)}](${url}/commit/${sha})`;
    return `- ${title} (${link})`;
  });
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short',
  }).format(now);
  return `## ${date}\n\nChanges merged into main since the previous update (the first update covers the past 24 hours). Release availability is separate.\n\n${bullets.join('\n')}\n\n<!-- boga-daily-log: ${head} -->`;
}

async function publish({ github, context, core }) {
  const checkpoint = await findCheckpoint(github, context.repo);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  if (checkpoint.sha) git('merge-base', '--is-ancestor', checkpoint.sha, head);
  const range = checkpoint.sha ? [`${checkpoint.sha}..${head}`] : ['--since=24 hours ago', head];
  const commits = git('log', '--first-parent', '--reverse', '--format=%H%x09%s', ...range);
  const body = buildEntry(commits, head, context.repo);
  if (!body) {
    core.info('No new main commits; no update posted.');
    return;
  }
  const result = await github.graphql(`
    mutation($id: ID!, $body: String!) {
      addDiscussionComment(input: { discussionId: $id, body: $body }) { comment { url } }
    }`, { id: checkpoint.id, body });
  core.info(result.addDiscussionComment.comment.url);
}

module.exports = { publish, buildEntry, findCheckpoint };
