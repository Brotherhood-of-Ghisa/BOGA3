import { fireEvent, render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

import { FormField } from '@/components/ui/form-field';
import { SearchField } from '@/components/ui/search-field';
import { UiText } from '@/components/ui/text';

const APP_ROOT = join(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const file = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx$/.test(file) ? [file] : [];
  });
}

// Screen-local Text/TextInput uses can bypass UiText and the field primitives.
// Check the parsed JSX (including import aliases), and require false AFTER
// every spread so callers cannot accidentally turn scaling back on.
it('disables font scaling on every app-owned native text and input', () => {
  const violations: string[] = [];
  let checked = 0;
  for (const file of ['app', 'components', 'src'].flatMap((dir) => sourceFiles(join(APP_ROOT, dir)))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const textNames = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'react-native') continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if (['Text', 'TextInput'].includes((binding.propertyName ?? binding.name).text)) {
            textNames.add(binding.name.text);
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        textNames.add(`${bindings.name.text}.Text`);
        textNames.add(`${bindings.name.text}.TextInput`);
      }
    }
    function visit(node: ts.Node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && textNames.has(node.tagName.getText(source))) {
        checked++;
        let fixed = false;
        for (const prop of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(prop)) fixed = false;
          else if (prop.name.getText(source) === 'allowFontScaling') {
            fixed = !!prop.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword;
          }
        }
        if (!fixed) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push(`${relative(APP_ROOT, file)}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(checked).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});

it('keeps shared text and nested text fixed even when a caller requests scaling', () => {
  render(<UiText allowFontScaling>Weight <UiText allowFontScaling>100 kg</UiText></UiText>);
  expect(screen.getByText('Weight 100 kg').props.allowFontScaling).toBe(false);
  expect(screen.getByText('100 kg').props.allowFontScaling).toBe(false);
});

it('keeps form values and validation text fixed while preserving editing', () => {
  const onChangeText = jest.fn();
  render(<FormField allowFontScaling label="Weight" value="100" error="Enter a positive weight" onChangeText={onChangeText} testID="weight" />);
  expect(screen.getByTestId('weight').props.allowFontScaling).toBe(false);
  expect(screen.getByText('Weight').props.allowFontScaling).toBe(false);
  expect(screen.getByText('Enter a positive weight').props.allowFontScaling).toBe(false);
  fireEvent.changeText(screen.getByTestId('weight'), '120');
  expect(onChangeText).toHaveBeenCalledWith('120');
});

it('keeps search fixed while preserving its clear action', () => {
  const onChangeText = jest.fn();
  render(<SearchField allowFontScaling accessibilityLabel="Exercise filter" value="Squat" onChangeText={onChangeText} />);
  expect(screen.getByLabelText('Exercise filter').props.allowFontScaling).toBe(false);
  fireEvent.press(screen.getByLabelText('Clear search'));
  expect(onChangeText).toHaveBeenCalledWith('');
});
