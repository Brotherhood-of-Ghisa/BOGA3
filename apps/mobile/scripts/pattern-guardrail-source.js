const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// These presentation definitions own geometry; feature style exports do not.
const PATTERN_FOUNDATIONS = [
  'components/ui/', 'components/stats/stats-table.tsx',
  'components/stats/comparison-columns.tsx', 'components/today/week-figures.tsx',
];
const isFoundation = file => PATTERN_FOUNDATIONS.some(entry => entry.endsWith('/') ? file.startsWith(entry) : file === entry);

function propertyName(node) {
  if (!node) return '';
  if (ts.isComputedPropertyName(node)) return propertyName(node.expression);
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : '';
}

function patternSource(file, sourceText) {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const aliases = new Map();
  const origins = new Map();
  const namespaces = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        aliases.set(item.name.text, (item.propertyName ?? item.name).text);
        origins.set(item.name.text, statement.moduleSpecifier.text);
      }
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, statement.moduleSpecifier.text);
  }
  const name = node => {
    if (ts.isIdentifier(node)) return aliases.get(node.text) ?? node.text;
    if (ts.isPropertyAccessExpression(node)) return namespaces.has(node.expression.getText(source)) ? node.name.text : `${name(node.expression)}.${node.name.text}`;
    if (ts.isElementAccessExpression(node)) return namespaces.has(node.expression.getText(source)) ? propertyName(node.argumentExpression) : `${name(node.expression)}.${propertyName(node.argumentExpression)}`;
    return node.getText(source);
  };
  const component = node => name(node).split('.').pop();
  const fromModule = (node, reference, expectedModule) => {
    if (name(node) !== reference) return false;
    let root = node;
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
    const specifier = origins.get(root.getText(source)) ?? namespaces.get(root.getText(source));
    const resolved = specifier?.startsWith('@/') ? specifier.slice(2)
      : specifier?.startsWith('.') ? path.posix.join(path.posix.dirname(file), specifier) : specifier;
    return resolved?.replace(/\.tsx?$/, '') === expectedModule;
  };
  return { source, name, component, fromModule };
}

// Follow imported style exports as well as conventional companions, including TSX.
function patternFiles(rootDir, entries) {
  const files = new Set(entries.flatMap(file => [file, ...['.styles.ts', '-styles.ts', '.styles.tsx', '-styles.tsx'].map(suffix => file.replace('.tsx', suffix))]));
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly || statement.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings ?? statement.exportClause;
      const names = [statement.importClause?.name?.text];
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) names.push(...bindings.elements.flatMap(item => [item.name.text, item.propertyName?.text]));
      if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
      const specifier = statement.moduleSpecifier.text;
      if (!names.some(name => /style/i.test(name ?? '')) && !/styles?(?:\.|$)/i.test(specifier) && !(ts.isExportDeclaration(statement) && !statement.exportClause)) continue;
      const base = specifier.startsWith('@/components/') ? specifier.slice(2)
        : specifier.startsWith('.') ? path.posix.join(path.posix.dirname(file), specifier) : null;
      if (!base || !base.startsWith('components/')) continue;
      const moduleBase = base.replace(/\.tsx?$/, '');
      const resolved = [base, `${moduleBase}.ts`, `${moduleBase}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
        .find(candidate => fs.existsSync(path.join(rootDir, candidate)) && fs.statSync(path.join(rootDir, candidate)).isFile());
      if (resolved && !isFoundation(resolved)) files.add(resolved);
    }
  }
  return [...files];
}

function attributeValue(attribute) {
  const initializer = attribute.initializer;
  const value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  return value && ts.isStringLiteralLike(value) ? value.text : null;
}

module.exports = { PATTERN_FOUNDATIONS, propertyName, patternSource, patternFiles, attributeValue };
