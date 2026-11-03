const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Only adopted Muscle presenters; Exercise and unrelated tables retain their contracts.
const TABLE_PATTERN_FILES = ['components/stats/progress-tables.tsx', 'components/stats/progress-muscle-view.tsx'];
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);
const ROW_FIELDS = new Set(['paddingVertical', 'paddingTop', 'paddingBottom', 'minHeight']);
const PATTERNS = new Set(['StatsTable', 'StatsTableRow', 'StatsTableName', 'StatsTableDisclosure']);

function findTablePatternViolations({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const violations = [];
  const files = TABLE_PATTERN_FILES.flatMap(file => [file, file.replace('.tsx', '.styles.ts'), file.replace('.tsx', '-styles.ts')]);
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    let hasTable = !file.endsWith('.tsx');
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(source);
        if (name === 'StatsTable') hasTable = true;
        if (name === 'ListRow') report(node, 'use StatsTableRow');
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !PATTERNS.has(name)) continue;
          const prop = attr.name.getText(source);
          if (prop === 'style' || prop.endsWith('Style') || prop === 'density') report(attr, 'table style override');
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'uiText' && ['body', 'bodyStrong', 'figure', 'option', 'optionLarge'].includes(node.name.text)) report(node, 'use table text presentation');
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'local typography assembly');
      if (ts.isPropertyAssignment(node) && ROW_FIELDS.has(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'table row geometry override');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!hasTable) report(source, 'missing StatsTable');
  }
  return violations;
}
module.exports = { TABLE_PATTERN_FILES, findTablePatternViolations };
