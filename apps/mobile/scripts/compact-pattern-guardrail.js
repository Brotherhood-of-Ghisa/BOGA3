const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Adopted presenters and their companion style modules; foundation definitions own roles.
const COMPACT_PATTERN_FILES = [
  'components/groups/stream-session-card.tsx',
  'components/groups/group-metric-stream-card.tsx',
  'components/groups/cow-preview.tsx',
  'components/today/group-cow-summary.tsx',
];
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);

function findCompactPatternViolations({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const violations = [];
  const files = COMPACT_PATTERN_FILES.flatMap(file => [file, file.replace('.tsx', '.styles.ts'), file.replace('.tsx', '-styles.ts')]);
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    let hasHeader = !file.endsWith('.tsx');
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(source);
        if (name === 'CompactHeader') hasHeader = true;
        if (['CompactHeader', 'CompactCard'].includes(name) && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'style')) {
          report(node, 'compact style override');
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'uiText' && ['title', 'sheetTitle', 'pageTitle'].includes(node.name.text)) {
        report(node, 'compact title role');
      }
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'local typography assembly');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!hasHeader) report(source, 'missing CompactHeader');
  }
  return violations;
}

module.exports = { COMPACT_PATTERN_FILES, findCompactPatternViolations };
