const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Family-specific adoption: unrelated screens and the existing sheet/list recipes are untouched.
const LIST_PATTERN_FILES = [
  'components/groups/group-home-board.tsx',
  'components/today/today-week-board.tsx',
];
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);
const ROW_FIELDS = new Set(['paddingVertical', 'paddingTop', 'paddingBottom', 'minHeight']);
const PATTERNS = new Set(['ListCard', 'ListCardHeader', 'ListRow']);

function findListPatternViolations({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const violations = [];
  const files = LIST_PATTERN_FILES.flatMap(file => [file, file.replace('.tsx', '.styles.ts'), file.replace('.tsx', '-styles.ts')]);
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    let hasList = !file.endsWith('.tsx');
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(source);
        if (name === 'ListCard') hasList = true;
        if (name === 'ListRow' && !node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'density')) report(node, 'noncompact adopted row');
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !PATTERNS.has(name)) continue;
          const prop = attr.name.getText(source);
          if (prop === 'style' || prop.endsWith('Style')) report(attr, 'list style override');
          if (name === 'ListRow' && prop === 'density' && attr.initializer?.getText(source) !== '"compact"') report(attr, 'noncompact adopted row');
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'uiText' && ['title', 'sheetTitle', 'pageTitle', 'option', 'optionLarge'].includes(node.name.text)) report(node, 'list text role');
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'local typography assembly');
      if (ts.isPropertyAssignment(node) && ROW_FIELDS.has(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'list row geometry override');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!hasList) report(source, 'missing ListCard');
  }
  return violations;
}

module.exports = { LIST_PATTERN_FILES, findListPatternViolations };
