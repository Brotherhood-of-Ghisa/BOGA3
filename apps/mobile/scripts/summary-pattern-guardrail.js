const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const FILES = ['components/groups/group-glance-page.tsx', 'components/groups/group-week-totals.tsx'];
const GEOMETRY_FIELDS = /^(padding|margin|gap|rowGap|columnGap|height|minHeight|maxHeight)/;
const TYPE_FIELDS = new Set(['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform']);

// Only adopted tile consumers and their style companions; shared metric primitives own type/geometry.
function findSummaryPatternViolations({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const violations = [];
  for (const file of FILES.flatMap(file => [file, file.replace('.tsx', '.styles.ts'), file.replace('.tsx', '-styles.ts')])) {
    const absolute = path.join(rootDir, file);
    if (!fs.existsSync(absolute)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    let hasTile = false;
    const report = (node, rule) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule });
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(source);
        if (name === 'SummaryTile') {
          hasTile = true;
          const metrics = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'metrics');
          const content = metrics?.initializer && ts.isJsxExpression(metrics.initializer) ? metrics.initializer.expression : null;
          if (!content || !ts.isJsxSelfClosingElement(content) || content.tagName.getText(source) !== 'GroupWeekTotalsFigures') report(node, 'summary metric composition');
        }
        if (file.startsWith('components/groups/group-week-totals')) {
          for (const attr of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attr) || (ts.isJsxAttribute(attr) && /style/i.test(attr.name.getText(source)) &&
              !(name === 'View' && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression?.getText(source) === 'weekFigureStyles.figures'))) report(attr, 'local summary geometry');
          }
        }
        if (['SummaryTile', 'GroupWeekTotalsFigures'].includes(name)) {
          for (const attr of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attr) || (ts.isJsxAttribute(attr) && /style/i.test(attr.name.getText(source)))) report(attr, 'summary style override');
          }
        }
      }
      if (ts.isPropertyAssignment(node) && TYPE_FIELDS.has(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'local summary typography');
      if (file.startsWith('components/groups/group-week-totals') && ts.isPropertyAssignment(node) && GEOMETRY_FIELDS.test(node.name.getText(source).replace(/['"]/g, ''))) report(node, 'local summary geometry');
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (file === FILES[0] && !hasTile) report(source, 'missing SummaryTile');
  }
  return violations;
}

module.exports = { findSummaryPatternViolations };
