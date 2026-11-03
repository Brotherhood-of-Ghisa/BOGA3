const { execFileSync } = require('child_process');

const meaningful = value => typeof value === 'string' && value.trim() !== '' && !/^(todo|tbd|pending|n\/a|none|unknown)(\b|$)|<[^>]+>/i.test(value.trim());

function approvalReference(value) {
  if (!value || !meaningful(value.by) || !meaningful(value.reference) || /\[bot\]$/i.test(value.by)) return false;
  try {
    const url = new URL(value.reference);
    return ['https:', 'codex:'].includes(url.protocol) && Boolean(url.hostname) && !/^(example\.(com|org)|localhost)$/.test(url.hostname);
  } catch { return false; }
}

// Only the trusted caller supplies context; candidate declarations cannot supply comments/permissions.
function acceptedCommentEntries(context, marker, pattern) {
  const api = route => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', route], { encoding: 'utf8' })).flat();
  const comments = context.comments ?? api(`repos/${context.repository}/issues/${context.number}/comments`);
  const accepted = new Set();
  for (const comment of comments) {
    if (comment.user?.type !== 'User') continue;
    const lines = (comment.body ?? '').trimEnd().split('\n');
    if (lines[0] !== marker || lines.slice(1).some(line => line !== '' && !pattern.test(line))) continue;
    const permission = context.permissions?.[comment.user.login] ?? api(`repos/${context.repository}/collaborators/${encodeURIComponent(comment.user.login)}/permission`)[0].permission;
    if (!['admin', 'maintain', 'write'].includes(permission)) continue;
    for (const line of lines.slice(1)) if (line) accepted.add(line.match(pattern)[1]);
  }
  return accepted;
}

module.exports = { meaningful, approvalReference, acceptedCommentEntries };
