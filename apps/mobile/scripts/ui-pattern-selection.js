const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const { meaningful } = require('./ui-design-acceptance');
const { reviewTemplatePromotions, registeredTemplateError } = require('./ui-template-promotion');
const { PATTERN_FOUNDATIONS, attributeValue } = require('./pattern-guardrail-source');
const { COMPACT_PATTERN_FILES } = require('./compact-pattern-guardrail');
const { LIST_PATTERN_FILES } = require('./list-pattern-guardrail');
const { TABLE_PATTERN_FILES } = require('./table-pattern-guardrail');
const { SUMMARY_PATTERN_FILES } = require('./summary-pattern-guardrail');

const TEMPLATE_SOURCES = {
  CompactCard: ['components/ui/compact-card.tsx', ...COMPACT_PATTERN_FILES],
  ListCard: ['components/ui/list-card.tsx', ...LIST_PATTERN_FILES],
  SortableTable: ['components/stats/stats-table.tsx', ...TABLE_PATTERN_FILES],
  SummaryTile: ['components/ui/summary-tile.tsx', ...SUMMARY_PATTERN_FILES],
};
const FAMILIES = [...Object.keys(TEMPLATE_SOURCES), 'catalog'];
const PREFIX = 'apps/mobile/';
const mobilePath = file => file.slice(PREFIX.length);
const isSource = file => /^apps\/mobile\/(app|components)\/.*\.(ts|tsx|js|jsx)$/s.test(file) && !/\/(?:__tests__|__snapshots__)\/|\.(?:test|spec|stories)\.[jt]sx?$/.test(file);
const gitOutput = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (root, args) => gitOutput(root, args).trim();
const gitPaths = (root, args) => gitOutput(root, [...args, '-z']).split('\0').filter(Boolean);
const isGalleryParent = (file, parent) => file === 'apps/mobile/app/ui-gallery.tsx' && parent.source.startsWith('apps/mobile/components/pattern-gallery/');
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const scopeName = name => (ts.isComputedPropertyName(name) ? name.expression : name).getText().replace(/['"]/g, '');

function hasJsx(source) {
  let found = false;
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}


const PRESENTATION_FIELD = /^(fontFamily|fontWeight|fontSize|lineHeight|letterSpacing|textTransform|padding.*|margin.*|gap|rowGap|columnGap|minHeight|minWidth|maxHeight|maxWidth|width|height|flex.*|align.*|justifyContent|border.*|backgroundColor|color|opacity|position|top|left|right|bottom|overflow|display|transform|shadow.*|elevation|textAlign|textDecoration.*)$/;
function presentationProperties(source) {
  const properties = new Map();
  const printer = ts.createPrinter({ removeComments: true });
  function visit(node, scope = []) {
    let next = scope;
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) next = [...scope, node.name.text];
    if (ts.isPropertyAssignment(node)) {
      const name = scopeName(node.name);
      next = [...scope, name];
      if (PRESENTATION_FIELD.test(name)) properties.set(next.join('.'), { node: node.initializer, value: printer.printNode(ts.EmitHint.Unspecified, node.initializer, source), recipe: printer.printNode(ts.EmitHint.Unspecified, node.parent, source) });
    }
    if (ts.isSpreadAssignment(node) && (scope.some(name => /style/i.test(name)) || /^ui(Text|Typography|Fonts|Geometry|Space|Border)\b/.test(node.expression.getText(source)))) {
      properties.set([...scope, `...${node.expression.getText(source)}`].join('.'), { node: node.expression, value: printer.printNode(ts.EmitHint.Unspecified, node.expression, source), recipe: printer.printNode(ts.EmitHint.Unspecified, node.parent, source) });
    }
    ts.forEachChild(node, child => visit(child, next));
  }
  visit(source);
  return properties;
}

function objectScopes(source) {
  const scopes = new Set();
  function visit(node, scope = []) {
    const named = (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isPropertyAssignment(node)) && node.name;
    const next = named ? [...scope, scopeName(node.name)] : scope;
    if (ts.isObjectLiteralExpression(node)) scopes.add(next.join('.'));
    ts.forEachChild(node, child => visit(child, next));
  }
  visit(source);
  return scopes;
}

function renderComponents(source) {
  const components = new Map();
  const printer = ts.createPrinter({ removeComments: true });
  const hasRenderOwner = node => {
    for (let owner = node.parent; owner; owner = owner.parent) {
      if (ts.isFunctionLike(owner) || ts.isClassDeclaration(owner) || ts.isClassExpression(owner)) return true;
    }
    return false;
  };
  const named = node => (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) ||
    ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
      (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) || /^[A-Z]/.test(node.name?.getText(source) ?? '') || !hasRenderOwner(node))) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name;
  function visit(node, scope = []) {
    let next = scope;
    const anonymousDefault = ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && !node.name && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) || ts.isExportAssignment(node) || ts.isConstructorDeclaration(node);
    if (named(node) || anonymousDefault) {
      next = [...scope, anonymousDefault ? 'default' : node.name.getText(source)];
      if (hasJsx(node)) components.set(next.join('.'), { node, signature: printer.printNode(ts.EmitHint.Unspecified, node, source) });
    }
    ts.forEachChild(node, child => visit(child, next));
  }
  visit(source);
  return components;
}

function changedComponents(rootDir, context, file) {
  const text = fs.readFileSync(path.join(rootDir, mobilePath(file)), 'utf8');
  const head = renderComponents(parse(file, text));
  const base = renderComponents(parse(file, context.readBase(file) ?? ''));
  return [...head.entries()].filter(([name, value]) => base.get(name)?.signature !== value.signature).map(([, value]) => value.node);
}

function designSignature(source) {
  const jsx = [];
  const bindings = new Map();
  const used = new Set();
  const printer = ts.createPrinter({ removeComments: true });
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    const module = statement.moduleSpecifier.getText(source);
    if (clause?.name) bindings.set(clause.name.text, [module, 'default']);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.set(clause.namedBindings.name.text, [module, '*']);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) {
      if (!item.isTypeOnly) bindings.set(item.name.text, [module, (item.propertyName ?? item.name).text]);
    }
  }
  function rememberBindings(node) {
    if (ts.isIdentifier(node) && bindings.has(node.text)) used.add(node.text);
    ts.forEachChild(node, rememberBindings);
  }
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      const normalized = ts.transform(node, [context => function normalize(child) {
        if (ts.isJsxAttribute(child) && /^on[A-Z]/.test(child.name.getText(source))) return ts.factory.updateJsxAttribute(child, child.name, ts.factory.createStringLiteral('handler'));
        return ts.visitEachChild(child, normalize, context);
      }]);
      rememberBindings(normalized.transformed[0]);
      jsx.push(printer.printNode(ts.EmitHint.Unspecified, normalized.transformed[0], source));
      normalized.dispose();
    } else ts.forEachChild(node, visit);
  }
  visit(source);
  const styles = [...presentationProperties(source)].map(([name, property]) => {
    rememberBindings(property.node);
    return [name, property.value];
  });
  return JSON.stringify({ jsx, styles, bindings: [...used].sort().map(name => [name, bindings.get(name)]) });
}

function reviewContext(rootDir) {
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_WORKFLOW === 'CI' && process.env.BOGA_UI_SELECTION_DELEGATED === '1') {
    return { files: [], delegated: true };
  }
  const repoRoot = git(rootDir, ['rev-parse', '--show-toplevel']);
  const event = (process.env.BOGA_UI_EVENT_PATH || process.env.GITHUB_EVENT_PATH) ? JSON.parse(fs.readFileSync(process.env.BOGA_UI_EVENT_PATH || process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  if (process.env.GITHUB_ACTIONS === 'true' && !event.pull_request) return { files: [], merged: true };
  const head = event.pull_request?.head.sha ?? 'HEAD';
  if (event.pull_request && git(repoRoot, ['rev-parse', 'HEAD']) !== head) throw new Error('UI pattern review must check out the event PR head SHA.');
  const base = git(repoRoot, ['merge-base', event.pull_request?.base.sha ?? 'origin/main', head]);
  const paths = gitPaths(repoRoot, ['diff', '--name-only', '--no-renames', base, ...(event.pull_request ? [head] : [])]);
  if (!event.pull_request) paths.push(...gitPaths(repoRoot, ['ls-files', '--others', '--exclude-standard']));
  const readBase = file => { try { return git(repoRoot, ['show', `${base}:${file}`]); } catch { return null; } };
  const files = [...new Set(paths)].filter(file => isSource(file) && fs.existsSync(path.join(rootDir, mobilePath(file))))
    .filter(file => designSignature(parse(file, fs.readFileSync(path.join(rootDir, mobilePath(file)), 'utf8'))) !== designSignature(parse(file, readBase(file) ?? '')));
  const draft = process.env.BOGA_UI_REVIEW_BODY || path.join(rootDir, 'artifacts/ui-review.md');
  return { files, head, finalReview: Boolean(event.pull_request), author: event.pull_request?.user.login,
    number: event.pull_request?.number, repository: process.env.GITHUB_REPOSITORY,
    body: event.pull_request ? event.pull_request.body ?? '' : fs.existsSync(draft) ? fs.readFileSync(draft, 'utf8') : '',
    readBase };
}

function exported(source, name) {
  return source.statements.some(statement => {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.some(item => item.name.text === name);
    }
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return true;
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === name);
  });
}

function resolveModule(rootDir, file, specifier) {
  const base = specifier.startsWith('@/') ? specifier.slice(2)
    : specifier.startsWith('.') ? path.posix.join(path.posix.dirname(file), specifier) : '';
  if (!base.startsWith('components/')) return null;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .find(candidate => fs.existsSync(path.join(rootDir, candidate)) && fs.statSync(path.join(rootDir, candidate)).isFile()) ?? null;
}

function exportOwner(rootDir, file, name, seen = new Set()) {
  const key = `${file}:${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const source = parse(file, fs.readFileSync(path.join(rootDir, file), 'utf8'));
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const next = resolveModule(rootDir, file, statement.moduleSpecifier.text);
    if (!next) continue;
    if (!statement.exportClause) {
      const owner = exportOwner(rootDir, next, name, seen);
      if (owner) return owner;
    } else if (ts.isNamedExports(statement.exportClause)) {
      const item = statement.exportClause.elements.find(item => item.name.text === name && !item.isTypeOnly);
      if (item) return exportOwner(rootDir, next, (item.propertyName ?? item.name).text, seen);
    }
  }
  return exported(source, name) ? { file, name } : null;
}

function parentElements(rootDir, file, parent, componentNode) {
  const relative = mobilePath(file);
  const source = parse(file, fs.readFileSync(path.join(rootDir, relative), 'utf8'));
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const module = resolveModule(rootDir, relative, statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (!module || !bindings) continue;
    if (ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (!item.isTypeOnly) imports.set(item.name.text, { module, name: (item.propertyName ?? item.name).text });
    }
    if (ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { module, namespace: true });
  }
  const elements = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      const binding = imports.get(ts.isPropertyAccessExpression(tag) ? tag.expression.getText(source) : tag.getText(source));
      const name = binding?.namespace && ts.isPropertyAccessExpression(tag) ? tag.name.text : binding?.name;
      const owner = binding && name ? exportOwner(rootDir, binding.module, name) : null;
      if (owner?.file === mobilePath(parent.source) && owner?.name === parent.export) elements.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(componentNode ?? source);
  return elements;
}

function usesParent(rootDir, file, parent, componentNode) {
  return parentElements(rootDir, file, parent, componentNode).length > 0;
}

function promotedPropsError(rootDir, file, parent, parents) {
  const variants = parents.filter(item => item.source === parent.source && item.export === parent.export).map(item => item.variant);
  for (const element of parentElements(rootDir, file, parent)) for (const attribute of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute) || /style$/i.test(attribute.name.getText())) return 'promoted template style/spread overrides need a custom design declaration';
    if (attribute.name.getText() === 'variant' && !variants.includes(attributeValue(attribute))) return 'rendered template variant must match its accepted declaration; dynamic variants need a custom design declaration';
  }
  return null;
}

function parentError(rootDir, context, file, parent, requireUse) {
  if (!parent || !FAMILIES.includes(parent.family) || !/^apps\/mobile\/components\/(?!.*(?:^|\/)\.\.\/).*\.(ts|tsx)$/.test(parent.source ?? '') || !/^[A-Z]\w*$/.test(parent.export ?? '')) return 'invalid production parent';
  if (parent.source.includes('/pattern-gallery/') && !isGalleryParent(file, parent)) return 'preview fixtures may only be parents of the guarded gallery route';
  const prior = context.readBase(parent.source);
  if (!prior || !exported(parse(parent.source, prior), parent.export)) return 'parent export did not exist at the base';
  const unchangedDefinition = parent.source === file && changedComponents(rootDir, context, file).length === 0;
  if (requireUse && !unchangedDefinition && !usesParent(rootDir, file, parent)) return 'declared parent must be imported and rendered from its production module';
  return null;
}

/** @param {{rootDir?: string, selectionContext?: object | null}} options */
function findUiPatternSelections({ rootDir = path.resolve(__dirname, '..'), selectionContext = null } = {}) {
  const violations = [];
  const filesByFamily = Object.fromEntries(Object.keys(TEMPLATE_SOURCES).map(family => [family, []]));
  const report = (file, rule) => violations.push({ file, line: 1, rule });
  try {
    const context = selectionContext ?? reviewContext(rootDir);
    let data = null;
    if (context.files.length || /^```ui-pattern-selection\b/m.test(context.body ?? '')) {
      const blocks = [...context.body.matchAll(/^```ui-pattern-selection\s*\n([\s\S]*?)^```[ \t]*$/gm)];
      if (blocks.length !== 1) throw new Error('Provide one ui-pattern-selection JSON block in artifacts/ui-review.md (local) or the PR body.');
      data = JSON.parse(blocks[0][1]);
      if (!Array.isArray(data.files)) throw new Error('ui-pattern-selection.files must be an array.');
    }
    const promotion = reviewTemplatePromotions({ rootDir, context, data, exported: (source, name) => exported(parse('template.tsx', source), name), usesParent, parentError });
    violations.push(...promotion.violations);
    if (!data) return { violations, filesByFamily, context };
    const seen = new Set();
    const headRecipes = new Set(context.files.flatMap(file => [...presentationProperties(parse(file, fs.readFileSync(path.join(rootDir, mobilePath(file)), 'utf8'))).values()].map(property => property.recipe)));
    const priorRecipes = new Set(context.files.flatMap(file => [...presentationProperties(parse(file, context.readBase(file) ?? '')).values()].map(property => property.recipe)));
    for (const record of data.files) {
      const file = record?.path;
      if (!context.files.includes(file) || seen.has(file)) { report(file ?? 'UI selection', 'duplicate or out-of-diff UI declaration'); continue; }
      seen.add(file);
      if (!['template', 'custom'].includes(record.mode) || !meaningful(record.delta) || !Array.isArray(record.parents) || record.parents.length === 0) {
        report(file, 'declare template/custom mode, production parents and design delta'); continue;
      }
      const components = changedComponents(rootDir, context, file);
      const definition = components.length === 0 && context.readBase(file) && PATTERN_FOUNDATIONS.some(entry => entry.endsWith('/') ? mobilePath(file).startsWith(entry) : mobilePath(file) === entry);
      if (record.mode === 'template') {
        const before = parse(file, context.readBase(file) ?? '');
        const after = parse(file, fs.readFileSync(path.join(rootDir, mobilePath(file)), 'utf8'));
        const previous = presentationProperties(before), current = presentationProperties(after);
        const previousScopes = objectScopes(before), currentScopes = objectScopes(after);
        const scopeOf = key => key.slice(0, key.lastIndexOf('.'));
        const removed = [...previous].some(([key, value]) => !current.has(key) && (definition || currentScopes.has(scopeOf(key)) || !headRecipes.has(value.recipe)));
        if (removed || [...current].some(([key, value]) => previous.has(key) ? previous.get(key).recipe !== value.recipe : !(definition && !previousScopes.has(scopeOf(key)) && priorRecipes.has(value.recipe)))) report(file, 'new or changed template typography/geometry needs a custom design declaration');
      }
      for (const parent of record.parents) {
        const error = parentError(rootDir, context, file, parent, record.mode === 'template');
        if (error) { report(file, error); continue; }
        const registeredError = registeredTemplateError(promotion.templates, parent);
        if (record.mode === 'template' && registeredError) report(file, registeredError);
        const registered = promotion.templates.some(template => template.source === parent.source && template.export === parent.export);
        if (record.mode === 'template' && registered) {
          const propError = promotedPropsError(rootDir, file, parent, record.parents);
          if (propError) report(file, propError);
        }
        const expectedFamily = Object.keys(TEMPLATE_SOURCES).find(family => TEMPLATE_SOURCES[family].includes(mobilePath(parent.source)));
        if (expectedFamily && parent.family !== expectedFamily) { report(file, 'known template parent must retain its inherited family'); continue; }
        if (record.mode === 'template' && !isGalleryParent(file, parent) && !TEMPLATE_SOURCES[parent.family]?.includes(mobilePath(parent.source)) && !registered) report(file, 'this parent is not an approved design template; declare custom design');
        if (record.mode === 'template' && parent.family !== 'catalog' && !definition) filesByFamily[parent.family].push(mobilePath(file));
      }
      if (record.mode === 'template') for (const component of components) {
        if (!record.parents.some(parent => usesParent(rootDir, file, parent, component))) report(file, `changed component ${component.name?.getText() ?? 'render'} does not inherit a declared design template; declare custom design`);
      }
    }
    for (const file of context.files) if (!seen.has(file)) report(file, 'missing UI pattern declaration for changed JSX/style source');
    return { violations, filesByFamily, context };
  } catch (error) {
    report('UI selection', error.message);
    return { violations, filesByFamily };
  }
}

module.exports = { TEMPLATE_SOURCES, hasJsx, reviewContext, findUiPatternSelections };
