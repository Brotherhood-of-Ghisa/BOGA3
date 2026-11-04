import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findUiPatternSelections, reviewContext } from '../scripts/ui-pattern-selection';
import { runUiGuardrailCheck } from '../scripts/check-ui-guardrails';

let rootDir: string;
const file = 'apps/mobile/components/groups/new-summary.tsx';
const parent = { family: 'ListCard', source: 'apps/mobile/components/ui/list-card.tsx', export: 'ListCard' };
const baseSources: Record<string, string> = {
  [parent.source]: 'export function ListCard() { return <View/>; }',
  'apps/mobile/components/ui/card.tsx': 'export function Card() { return <View/>; }',
};
const record = () => ({ path: file, mode: 'template', parents: [parent], delta: 'Reuse the unchanged compact list template.' });
const body = (files: unknown[]) => `\`\`\`ui-pattern-selection\n${JSON.stringify({ files })}\n\`\`\``;
function write(name: string, source: string) {
  const target = path.join(rootDir, name.replace(/^apps\/mobile\//, ''));
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
}
function context(files: unknown[] = [record()]) {
  return { files: [file], body: body(files), head: 'abc123', author: 'author', finalReview: false,
    readBase: (name: string): string | null => baseSources[name] ?? null };
}
beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-pattern-selection-'));
  for (const [name, source] of Object.entries(baseSources)) write(name, source);
  write('apps/mobile/components/ui/index.ts', "export { ListCard } from './list-card';");
  write(file, "import { ListCard as Board } from '@/components/ui'; export const Example = () => <Board/>;");
});
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));
const check = (selectionContext = context()) => findUiPatternSelections({ rootDir, selectionContext });

it('requires a declaration for a new component or new JSX in an existing source', () => {
  expect(check({ ...context(), body: '' }).violations).toEqual([expect.objectContaining({ rule: expect.stringContaining('one ui-pattern-selection') })]);
  expect(check(context([])).violations).toEqual([expect.objectContaining({ file, rule: 'missing UI pattern declaration for changed JSX/style source' })]);
});
it('accepts an imported production template through aliases and a barrel without per-instance approval', () => {
  expect(check()).toMatchObject({ violations: [], filesByFamily: { ListCard: ['components/groups/new-summary.tsx'] } });
});
it('rejects the demonstrated token-only Card bypass as template reuse', () => {
  write(file, "import { Card } from '@/components/ui/card'; const Example = () => <Card/>;");
  const customParent = { family: 'catalog', source: 'apps/mobile/components/ui/card.tsx', export: 'Card' };
  const result = check(context([{ ...record(), parents: [customParent] }]));
  expect(result.violations.map(item => item.rule)).toContain('this parent is not an approved design template; declare custom design');
});
it('checks inherited density and spacing for newly declared consumers in the existing lane', () => {
  write(file, "import { ListCard } from '@/components/ui/list-card'; const Example = () => <ListCard><View style={{paddingVertical: uiSpace.xl}}/></ListCard>;");
  const output: string[] = [];
  expect(runUiGuardrailCheck({ rootDir, selectionContext: context(), stdout: { write: (value: string) => output.push(value) } }).ok).toBe(false);
  expect(output.join('')).toContain('list row geometry override');
});
it('rejects self-invented exports in existing modules and parents that are not actually used', () => {
  const data = { ...record(), parents: [{ ...parent, export: 'NewTemplate' }] };
  expect(check(context([data])).violations.map(item => item.rule)).toContain('parent export did not exist at the base');
  write(file, 'const Example = () => <View/>;');
  expect(check().violations.map(item => item.rule)).toContain('declared parent must be imported and rendered from its production module');
});
it('requires exact file coverage and rejects duplicate and stale declarations', () => {
  expect(check(context([record(), record()])).violations.map(item => item.rule)).toContain('duplicate or out-of-diff UI declaration');
  expect(check(context([{ ...record(), path: 'apps/mobile/components/groups/deleted.tsx' }])).violations).toHaveLength(2);
});
it.each(['', 'TODO', 'TBD', '<description>'])('rejects placeholder delta %s', delta => {
  expect(check(context([{ ...record(), delta }])).violations.map(item => item.rule)).toContain('declare template/custom mode, production parents and design delta');
});
it('fails malformed JSON and multiple declaration blocks', () => {
  expect(check({ ...context(), body: '```ui-pattern-selection\n{\n```' }).violations).toHaveLength(1);
  expect(check({ ...context(), body: body([record()]) + body([record()]) }).violations).toHaveLength(1);
});

const customRecord = () => ({ ...record(), mode: 'custom', delta: 'Derived layout outside the approved template.' });
const finalContext = () => ({ ...context([customRecord()]), finalReview: true });
it('allows custom design locally and on a PR without pre-build evidence or acceptance comments', () => {
  const customParent = { family: 'catalog', source: 'apps/mobile/components/ui/card.tsx', export: 'Card' };
  write(file, "import { Card } from '@/components/ui/card'; export function Example(){return <Card/>;}");
  const selection = { ...customRecord(), parents: [customParent] };
  expect(check(context([selection])).violations).toEqual([]);
  expect(check({ ...finalContext(), body: body([selection]) }).violations).toEqual([]);
});
it('keeps custom design valid across unrelated pushes without renewed acceptance', () => {
  for (const head of ['first-head', 'next-head']) {
    expect(check({ ...finalContext(), head }).violations).toEqual([]);
  }
});
it('permits a custom delta without approval while keeping global token rules', () => {
  write(file, "import { ListCard } from '@/components/ui/list-card'; const Example = () => <ListCard><View style={{paddingVertical:uiSpace.xl}}/></ListCard>;");
  expect(runUiGuardrailCheck({ rootDir, selectionContext: finalContext(), stdout: { write() {} } }).ok).toBe(true);
  write(file, "import { ListCard } from '@/components/ui/list-card'; const Example = () => <ListCard><Text style={{color:'#123456'}}>Hello</Text></ListCard>;");
  expect(runUiGuardrailCheck({ rootDir, selectionContext: finalContext(), stdout: { write() {} } }).ok).toBe(false);
});

it('detects untracked files, renames and newly introduced JSX in an existing file from the Git diff', () => {
  const repo = path.join(rootDir, 'repo'); const mobile = path.join(repo, 'apps/mobile'); fs.mkdirSync(mobile, { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  fs.mkdirSync(path.join(mobile, 'components'), { recursive: true });
  fs.writeFileSync(path.join(mobile, 'components/old.tsx'), 'export const value = 1;');
  fs.writeFileSync(path.join(mobile, 'components/last-style.ts'), 'export const style = { padding: uiSpace.md };');
  fs.writeFileSync(path.join(mobile, 'components/renamed.tsx'), 'export const Old = () => <View/>;');
  git(['add', '.']); git(['commit', '-qm', 'base']); git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  fs.writeFileSync(path.join(mobile, 'components/last-style.ts'), 'export const style = {};');
  fs.writeFileSync(path.join(mobile, 'components/old.tsx'), 'export const Old = () => <View/>;');
  fs.renameSync(path.join(mobile, 'components/renamed.tsx'), path.join(mobile, 'components/new-name.tsx'));
  fs.writeFileSync(path.join(mobile, 'components/café-card.tsx'), 'export const Cafe = () => <View/>;');
  fs.writeFileSync(path.join(mobile, 'components/row-styles.ts'), 'export const row = { paddingVertical: uiSpace.xl };');
  const saved = { ...process.env };
  try {
    delete process.env.GITHUB_ACTIONS; delete process.env.GITHUB_EVENT_PATH; delete process.env.GITHUB_WORKFLOW;
    const result = reviewContext(mobile);
    expect(result.files.sort()).toEqual(['apps/mobile/components/café-card.tsx', 'apps/mobile/components/last-style.ts', 'apps/mobile/components/new-name.tsx', 'apps/mobile/components/old.tsx', 'apps/mobile/components/row-styles.ts']);
  } finally { Object.assign(process.env, saved); }
});


const existingDesign = "import { Card } from '@/components/ui/card'; export function Existing(){const save = () => submit(); return <Card onPress={save}/>;}";
it.each([
  ['comment', existingDesign, `${existingDesign}\n// Keep the current design.`, false],
  ['save handler', existingDesign, existingDesign.replace('submit()', 'submit({ retry: true })'), false],
  ['inline handler', existingDesign.replace('{save}', '{() => submit()}'), existingDesign.replace('{save}', '{() => submit({ retry: true })}'), false],
  ['formatting', existingDesign, existingDesign.replace('const save', '\n  const save'), false],
  ['new content', existingDesign, existingDesign.replace('<Card onPress={save}/>', '<Card onPress={save}><Text>New summary</Text></Card>'), true],
  ['changed style', 'export const styles = { padding: uiSpace.md };', 'export const styles = { padding: uiSpace.lg };', true],
  ['style spread', 'export const styles = { title: { ...uiText.body } };', 'export const styles = { title: { ...uiText.pageTitle } };', true],
  ['component binding', "import { Card as Panel } from '@/components/ui'; export const Existing = () => <Panel/>;", "import { SummaryTile as Panel } from '@/components/ui'; export const Existing = () => <Panel/>;", true],
  ['non-render logic', 'export const styles = { padding: uiSpace.md }; export const retry = false;', 'export const styles = { padding: uiSpace.md }; export const retry = true;', false],
])('requires declarations only when %s edits change JSX or presentation', (_name, before, after, needsDeclaration) => {
  const repo = path.join(rootDir, 'maintenance');
  const mobile = path.join(repo, 'apps/mobile');
  const target = path.join(mobile, 'components/existing.tsx');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(target, before);
  git(['add', '.']); git(['commit', '-qm', 'base']); git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  fs.writeFileSync(target, after);
  const saved = { ...process.env };
  try {
    delete process.env.GITHUB_ACTIONS; delete process.env.GITHUB_EVENT_PATH; delete process.env.GITHUB_WORKFLOW;
    delete process.env.BOGA_UI_EVENT_PATH; delete process.env.BOGA_UI_REVIEW_BODY;
    const selectionContext = reviewContext(mobile);
    expect(selectionContext.files).toEqual(needsDeclaration ? ['apps/mobile/components/existing.tsx'] : []);
    const result = findUiPatternSelections({ rootDir: mobile, selectionContext });
    expect(result.violations).toEqual(needsDeclaration
      ? [expect.objectContaining({ rule: expect.stringContaining('one ui-pattern-selection') })] : []);
  } finally {
    Object.assign(process.env, saved);
  }
});

it('keeps preview exports outside production template reuse', () => {
  const preview = 'apps/mobile/components/pattern-gallery/list-gallery.tsx';
  const source = 'export function ListGallery() { return <View/>; }';
  write(preview, source);
  write(file, "import { ListGallery } from '../pattern-gallery/list-gallery'; const Example = () => <ListGallery/>;");
  const data = { ...record(), parents: [{ family: 'ListCard', source: preview, export: 'ListGallery' }] };
  const result = check({ ...context([data]), readBase: (name: string) => name === preview ? source : baseSources[name] ?? null });
  expect(result.violations.map(item => item.rule)).toContain('preview fixtures may only be parents of the guarded gallery route');
});
it('does not silently accept stale declarations when the change has no JSX', () => {
  expect(check({ ...context(), files: [] }).violations.map(item => item.rule)).toContain('duplicate or out-of-diff UI declaration');
});
it('allows several declared custom components without per-file acceptance', () => {
  const second = 'apps/mobile/components/groups/second.tsx';
  write(second, "import { ListCard } from '@/components/ui/list-card'; const Example = () => <ListCard/>;");
  const result = check({ ...finalContext(), files: [file, second], body: body([customRecord(), { ...customRecord(), path: second }]) });
  expect(result.violations).toEqual([]);
});
it('pins PR source to the event head and keeps the code-CI delegation explicit', () => {
  const saved = { ...process.env };
  const repo = path.join(rootDir, 'event-repo'); const mobile = path.join(repo, 'apps/mobile'); fs.mkdirSync(mobile, { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(mobile, 'base.txt'), 'base'); git(['add', '.']); git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(mobile, 'components'), { recursive: true });
  fs.writeFileSync(path.join(mobile, 'components/new.tsx'), 'export const New = () => <View/>;');
  git(['add', '.']); git(['commit', '-qm', 'head']); const head = git(['rev-parse', 'HEAD']);
  const eventPath = path.join(repo, 'event.json');
  try {
    process.env.GITHUB_ACTIONS = 'true'; process.env.GITHUB_WORKFLOW = 'UI pattern review'; process.env.GITHUB_EVENT_PATH = eventPath;
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 12, base: { sha: base }, head: { sha: head }, user: { login: 'author' }, body: 'event body' } }));
    expect(reviewContext(mobile)).toMatchObject({ head, body: 'event body', finalReview: true, files: ['apps/mobile/components/new.tsx'] });
    git(['checkout', '-q', base]);
    expect(() => reviewContext(mobile)).toThrow('event PR head SHA');
    process.env.GITHUB_WORKFLOW = 'CI'; process.env.BOGA_UI_SELECTION_DELEGATED = '1';
    expect(reviewContext(mobile)).toEqual({ files: [], delegated: true });
    process.env.GITHUB_WORKFLOW = 'UI pattern review';
    expect(() => reviewContext(mobile)).toThrow('event PR head SHA');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

it('cannot hide a new custom component beside an unchanged template renderer', () => {
  const container = 'apps/mobile/components/ui/list-card.tsx';
  const before = "import { CompactHeader } from './compact-card'; export function ListCardHeader() {return <CompactHeader/>;}";
  const heading = 'apps/mobile/components/ui/compact-card.tsx';
  const headingCode = 'export function CompactHeader(){return <View/>;}';
  write(heading, headingCode);
  write(container, before + ' export function NewCustomHero(){return <View style={{padding:uiSpace.xl}}><Text style={uiText.pageTitle}>Hero</Text></View>;}');
  const data = { ...record(), path: container, parents: [{ family: 'CompactCard', source: heading, export: 'CompactHeader' }] };
  const selectionContext = { ...context([data]), files: [container], finalReview: true, comments: [],
    readBase: (name: string) => name === container ? before : name === heading ? headingCode : null };
  expect(check(selectionContext).violations.map(item => item.rule)).toContainEqual(expect.stringContaining('does not inherit a declared design template'));
});
it('cannot relabel a known template parent as catalog to drop its family checks', () => {
  expect(check(context([{ ...customRecord(), parents: [{ ...parent, family: 'catalog' }] }])).violations.map(item => item.rule)).toContain('known template parent must retain its inherited family');
});
it('resolves renamed re-exports to their original production owner and export', () => {
  write('apps/mobile/components/ui/index.ts', "export { ListCard as SharedList } from './list-card';");
  write(file, "import { SharedList } from '@/components/ui'; const Example = () => <SharedList/>;");
  expect(check().violations).toEqual([]);
});
it('executes protected base policy and publishes candidate-head checks on body and review edits', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/ui-pattern-review.yml'), 'utf8');
  expect(workflow).toContain('pull_request_target:');
  expect(workflow).toContain('types: [opened, synchronize, reopened, edited]');
  expect(workflow).toContain('issue_comment:');
  expect(workflow).toContain('types: [created, edited, deleted]');
  expect(workflow).not.toContain('pull_request_review:');
  expect(workflow).toContain('ref: ${{ steps.pr.outputs.base }}\n          path: policy');
  expect(workflow).toMatch(/run: npm ci --ignore-scripts\n[^\n]*\n\s+working-directory: policy\/apps\/mobile/);
  expect(workflow).toContain('run: node scripts/check-ui-guardrails.js\n        working-directory: policy/apps/mobile');
  expect(workflow).toContain('head_sha: pr.head.sha');
  expect(workflow).toContain('github.rest.checks.update');
  expect(workflow).not.toMatch(/working-directory: candidate/);
});

it('requires a custom declaration when an existing template adds a new geometry property', () => {
  const before = baseSources[parent.source] + ' export const styles = { card: { padding: uiSpace.md } };';
  write(parent.source, before.replace('padding: uiSpace.md', 'padding: uiSpace.md, paddingVertical: uiSpace.xl'));
  const selectionContext = { ...context([{ ...record(), path: parent.source }]), files: [parent.source],
    readBase: (name: string) => name === parent.source ? before : baseSources[name] ?? null };
  expect(check(selectionContext).violations.map(item => item.rule)).toContain('new or changed template typography/geometry needs a custom design declaration');
});
it('rejects anonymous default UI changes hidden beside an unchanged template user', () => {
  const before = "import { ListCard } from '@/components/ui/list-card'; function Retained(){return <ListCard/>;} export default function(){return <View/>;}";
  write(file, before.replace('return <View/>', 'return <Pressable><Text>New design</Text></Pressable>'));
  const selectionContext = { ...context(), readBase: (name: string) => name === file ? before : baseSources[name] ?? null };
  expect(check(selectionContext).violations.map(item => item.rule)).toContainEqual(expect.stringContaining('does not inherit a declared design template'));
});
it('permits an unchanged style recipe moved to its existing template foundation', () => {
  const recipe = '{ padding: uiSpace.md, gap: uiSpace.sm }';
  const before = baseSources[parent.source];
  const consumer = "import { ListCard } from '@/components/ui/list-card'; export const Example = () => <ListCard/>;";
  write(file, consumer);
  write(parent.source, before + ` export const styles = { header: ${recipe} };`);
  const selectionContext = { ...context([record(), { ...record(), path: parent.source }]), files: [file, parent.source],
    readBase: (name: string) => name === file ? consumer + ` const oldStyles = { header: ${recipe} };` : baseSources[name] ?? null };
  expect(check(selectionContext).violations).toEqual([]);
});

it('requires a custom declaration when a template removes its last geometry property', () => {
  const before = baseSources[parent.source] + ' export const styles = { card: { padding: uiSpace.md } };';
  write(parent.source, before.replace('padding: uiSpace.md', ''));
  const selectionContext = { ...context([{ ...record(), path: parent.source }]), files: [parent.source],
    readBase: (name: string) => name === parent.source ? before : baseSources[name] ?? null };
  expect(check(selectionContext).violations.map(item => item.rule)).toContain('new or changed template typography/geometry needs a custom design declaration');
});

it.each([
  'export const Cards = { Hero: () => <View><Text>New composition</Text></View> };',
  'export const Cards = { Hero() { return <View><Text>New composition</Text></View>; } };',
  'export const Hero = <View><Text>New composition</Text></View>;',
  'export const customBody = <View><Text>New composition</Text></View>;',
])('rejects new compound component properties and JSX variables beside unchanged template use: %s', addition => {
  const retained = "import { ListCard } from '@/components/ui/list-card'; function Retained(){return <ListCard/>;}";
  write(file, retained + addition);
  const selectionContext = { ...context(), readBase: (name: string) => name === file ? retained : baseSources[name] ?? null };
  expect(check(selectionContext).violations.map(item => item.rule)).toContainEqual(expect.stringContaining('does not inherit a declared design template'));
});

it.each(['add', 'remove'])('does not borrow an unrelated existing recipe to waive a template geometry %s', change => {
  const second = 'apps/mobile/components/ui/summary-tile.tsx';
  const compact = '{ padding: uiSpace.md }', roomy = '{ padding: uiSpace.md, gap: uiSpace.sm }';
  const before = baseSources[parent.source] + ` export const styles = { card: ${change === 'add' ? compact : roomy} };`;
  const other = 'export function SummaryTile(){return <View/>;} export const styles = { card: ' + roomy + ' };';
  write(parent.source, before.replace(change === 'add' ? compact : roomy, change === 'add' ? roomy : compact));
  write(second, other + ' export const changedLogic = true;');
  const selectionContext = { ...context([{ ...record(), path: parent.source }, { ...record(), path: second, parents: [{ family: 'SummaryTile', source: second, export: 'SummaryTile' }] }]), files: [parent.source, second],
    readBase: (name: string) => name === parent.source ? before : name === second ? other : null };
  expect(check(selectionContext).violations).toContainEqual(expect.objectContaining({ file: parent.source, rule: 'new or changed template typography/geometry needs a custom design declaration' }));
});

it('allows local ReactNode content inside the existing template slots', () => {
  write(file, "import { ListCard } from '@/components/ui/list-card'; export function Example(){const body=<View><Text>Content</Text></View>;return <ListCard>{body}</ListCard>;}");
  expect(check().violations).toEqual([]);
});
it('requires a custom declaration when a template adds a style spread to an existing recipe', () => {
  const before = baseSources[parent.source] + ' export const styles = { card: { padding: uiSpace.md } };';
  write(parent.source, before.replace('padding: uiSpace.md', 'padding: uiSpace.md, ...uiText.title'));
  const selectionContext = { ...context([{ ...record(), path: parent.source }]), files: [parent.source],
    readBase: (name: string) => name === parent.source ? before : baseSources[name] ?? null };
  expect(check(selectionContext).violations.map(item => item.rule)).toContain('new or changed template typography/geometry needs a custom design declaration');
});
