const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { propertyName, patternSource, patternFiles, attributeValue } = require('./pattern-guardrail-source');

// Family-specific adoption: unrelated screens and the existing sheet/list recipes are untouched.
const LIST_PATTERN_FILES = [
  'components/groups/group-home-board.tsx',
  'components/today/today-week-board.tsx',
];
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);
const ROW_FIELDS = new Set(['padding', 'paddingVertical', 'paddingTop', 'paddingBottom', 'paddingBlock', 'paddingBlockStart', 'paddingBlockEnd', 'marginVertical', 'marginTop', 'marginBottom', 'minHeight']);
const PATTERNS = new Set(['ListCard', 'ListCardHeader', 'ListRow']);

function findListPatternViolations({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const violations = [];
  const files = patternFiles(rootDir, LIST_PATTERN_FILES);
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const { source, name: referenceName, component } = patternSource(file, fs.readFileSync(absolute, 'utf8'));
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    let hasList = !LIST_PATTERN_FILES.includes(file);
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = component(node.tagName);
        if (name === 'ListCard') hasList = true;
        if (name === 'ListRow' && !node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'density')) report(node, 'noncompact adopted row');
        for (const attr of node.attributes.properties) {
          if (!PATTERNS.has(name)) continue;
          if (ts.isJsxSpreadAttribute(attr)) { report(attr, 'list style override'); continue; }
          if (!ts.isJsxAttribute(attr)) continue;
          const prop = attr.name.getText(source);
          if (/style/i.test(prop)) report(attr, 'list style override');
          if (name === 'ListRow' && prop === 'density' && attributeValue(attr) !== 'compact') report(attr, 'noncompact adopted row');
        }
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && referenceName(node.expression) === 'uiText' && ['title', 'sheetTitle', 'pageTitle', 'option', 'optionLarge'].includes(referenceName(node).split('.').pop())) report(node, 'list text role');
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(propertyName(node.name))) report(node, 'local typography assembly');
      if (ts.isPropertyAssignment(node) && ROW_FIELDS.has(propertyName(node.name))) report(node, 'list row geometry override');
      if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && referenceName(node.expression).endsWith('.toUpperCase')) report(node, 'local casing assembly');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!hasList) report(source, 'missing ListCard');
  }
  return violations;
}

module.exports = { LIST_PATTERN_FILES, findListPatternViolations };
