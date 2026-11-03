const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { propertyName, patternSource, patternFiles } = require('./pattern-guardrail-source');

// Only adopted Muscle presenters; Exercise and unrelated tables retain their contracts.
const TABLE_PATTERN_FILES = ['components/stats/progress-tables.tsx', 'components/stats/progress-muscle-view.tsx'];
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);
const ROW_FIELDS = new Set(['padding', 'paddingVertical', 'paddingTop', 'paddingBottom', 'paddingBlock', 'paddingBlockStart', 'paddingBlockEnd', 'marginVertical', 'marginTop', 'marginBottom', 'minHeight']);
const PATTERNS = new Set(['StatsTable', 'StatsTableRow', 'StatsTableName', 'StatsTableDisclosure']);

function findTablePatternViolations({ rootDir = path.resolve(__dirname, '..'), adoptedFiles = [] } = {}) {
  const violations = [];
  const files = patternFiles(rootDir, [...TABLE_PATTERN_FILES, ...adoptedFiles]);
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const { source, name: referenceName, component } = patternSource(file, fs.readFileSync(absolute, 'utf8'));
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    let hasTable = !TABLE_PATTERN_FILES.includes(file);
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = component(node.tagName);
        if (name === 'StatsTable') hasTable = true;
        if (name === 'ListRow') report(node, 'use StatsTableRow');
        for (const attr of node.attributes.properties) {
          if (!PATTERNS.has(name)) continue;
          if (ts.isJsxSpreadAttribute(attr)) { report(attr, 'table style override'); continue; }
          if (!ts.isJsxAttribute(attr)) continue;
          const prop = attr.name.getText(source);
          if (prop === 'style' || prop.endsWith('Style') || prop === 'density') report(attr, 'table style override');
        }
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && referenceName(node.expression) === 'uiText' && ['body', 'bodyStrong', 'figure', 'option', 'optionLarge'].includes(referenceName(node).split('.').pop())) report(node, 'use table text presentation');
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(propertyName(node.name))) report(node, 'local typography assembly');
      if (ts.isPropertyAssignment(node) && ROW_FIELDS.has(propertyName(node.name))) report(node, 'table row geometry override');
      if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && referenceName(node.expression).endsWith('.toUpperCase')) report(node, 'local casing assembly');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!hasTable) report(source, 'missing StatsTable');
  }
  return violations;
}
module.exports = { TABLE_PATTERN_FILES, findTablePatternViolations };
