const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { propertyName, patternSource, patternFiles } = require('./pattern-guardrail-source');

// Adopted presenters and their companion style modules; foundation definitions own roles.
const COMPACT_PATTERN_FILES = [
  'components/groups/stream-session-card.tsx',
  'components/groups/group-metric-stream-card.tsx',
  'components/groups/cow-preview.tsx',
  'components/today/group-cow-summary.tsx',
];
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);

function findCompactPatternViolations({ rootDir = path.resolve(__dirname, '..'), adoptedFiles = [] } = {}) {
  const violations = [];
  const files = patternFiles(rootDir, [...COMPACT_PATTERN_FILES, ...adoptedFiles]);
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const { source, name: referenceName, component } = patternSource(file, fs.readFileSync(absolute, 'utf8'));
    let hasHeader = !COMPACT_PATTERN_FILES.includes(file);
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = component(node.tagName);
        if (name === 'CompactHeader') hasHeader = true;
        if (['CompactHeader', 'CompactCard'].includes(name) && node.attributes.properties.some(attr => ts.isJsxSpreadAttribute(attr) || ts.isJsxAttribute(attr) && /style/i.test(attr.name.getText(source)))) {
          report(node, 'compact style override');
        }
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && referenceName(node.expression) === 'uiText' && ['title', 'sheetTitle', 'pageTitle'].includes(referenceName(node).split('.').pop())) {
        report(node, 'compact title role');
      }
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(propertyName(node.name))) report(node, 'local typography assembly');
      if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && referenceName(node.expression).endsWith('.toUpperCase')) report(node, 'local casing assembly');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!hasHeader) report(source, 'missing CompactHeader');
  }
  return violations;
}

module.exports = { COMPACT_PATTERN_FILES, findCompactPatternViolations };
