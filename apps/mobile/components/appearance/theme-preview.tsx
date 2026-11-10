import { StyleSheet, Text, View } from 'react-native';

import { FigureText, uiBorder, uiGeometry, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import type { UiRoles } from '@/components/ui/theme';
import type { CustomPart } from '@/components/ui/theme-custom';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { formatOneRepMax } from '@/src/exercise-calculations/format';

type ThemePreviewProps = {
  roles: UiRoles;
  testID?: string;
};

// The mock's two sets and their 1RM through the real formula ([[1rm.formula]]):
// a performed 80 × 8 and a planned 82.5 × 8 ([[set.row-figures]]).
// The header counts the one performed set ([[set.count-display]]).
const oneRepMax = (weight: number, reps: number) => formatOneRepMax(estimateOneRepMax(weight, reps)!);
const PREVIEW_ONE_REP_MAX = { performed: oneRepMax(80, 8), planned: oneRepMax(82.5, 8) };

const HEATMAP: (keyof UiRoles)[] = ['viz0', 'viz2', 'viz1', 'viz0', 'viz3', 'viz4', 'viz2', 'viz0', 'viz1', 'viz3', 'viz4', 'viz0'];

// A small mock of the app drawn in another theme's roles: the screens are drawn
// in the saved theme, so the preview cannot reuse their colours. Every colour
// here comes from `roles`; the layout comes from the shared tokens.
export function ThemePreview({ roles, testID }: ThemePreviewProps) {
  const type = useUiText();
  const tone = useUiTextTone();
  const text = (colour: string) => ({ color: colour });
  return (
    <View
      accessibilityLabel="Preview of the theme"
      importantForAccessibility="no-hide-descendants"
      style={[styles.page, { backgroundColor: roles.paper, borderColor: roles.rule }]}
      testID={testID}>
      <View style={[styles.card, { backgroundColor: roles.surface, borderColor: roles.rule }]}>
        <View style={styles.cardHeader}>
          <Text allowFontScaling={false} style={[type.title, text(roles.ink)]}>
            Bench Press
          </Text>
          <Text allowFontScaling={false} style={[type.meta, text(roles.inkMuted)]}>
            <FigureText>{`1 set · 1RM ${PREVIEW_ONE_REP_MAX.performed}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.setRow, { borderTopColor: roles.ruleSoft }]}>
          <Text allowFontScaling={false} style={[type.figure, styles.setIndex, text(roles.inkFaint)]}>
            1
          </Text>
          <Text allowFontScaling={false} style={[type.figure, styles.figureCell, text(roles.ink)]}>
            80 × 8
          </Text>
          <Text allowFontScaling={false} style={[type.meta, text(roles.inkFaint)]}>
            <FigureText>{`1RM ${PREVIEW_ONE_REP_MAX.performed}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.setRow, { borderTopColor: roles.ruleSoft, backgroundColor: roles.accentWash }]}>
          <Text allowFontScaling={false} style={[type.figure, styles.setIndex, text(roles.accent)]}>
            2
          </Text>
          <Text allowFontScaling={false} style={[type.figure, styles.figureCell, text(roles.ink)]}>
            82.5 × 8
          </Text>
          <Text allowFontScaling={false} style={[type.meta, text(roles.inkGhost)]}>
            <FigureText>{`1RM ${PREVIEW_ONE_REP_MAX.planned}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.record, { backgroundColor: roles.recordWash, borderTopColor: roles.recordRule }]}>
          <Text allowFontScaling={false} style={[type.label, text(roles.record)]}>
            BEST EVER
          </Text>
          <Text allowFontScaling={false} style={[type.figure, tone.record, styles.figureCell, styles.recordFigure, text(roles.record)]}>
            105.0
          </Text>
        </View>
      </View>
      <View style={styles.heatmap}>
        {HEATMAP.map((role, index) => (
          <View
            key={index}
            style={[
              styles.cell,
              { backgroundColor: roles[role] },
              role === 'viz0' ? { borderWidth: uiBorder.width, borderColor: roles.rule } : null,
            ]}
          />
        ))}
      </View>
      <View style={styles.actions}>
        <View style={[styles.button, styles.buttonOutline, { borderColor: roles.danger, backgroundColor: roles.surface }]}>
          <Text allowFontScaling={false} style={[type.button, text(roles.danger)]}>
            DELETE
          </Text>
        </View>
        <View style={[styles.button, styles.buttonPrimary, { backgroundColor: roles.accent }]}>
          <Text allowFontScaling={false} style={[type.button, text(roles.onAccent)]}>
            LOG SET
          </Text>
        </View>
      </View>
    </View>
  );
}

type Role = keyof UiRoles;

// One sample of a role in the use the app gives it: a fill, text (`Aa`) or a
// hairline, on a ground. A `context` sample is another part's role, shown
// for comparison (the ramp's empty cell beside its steps).
type Sample = { label: string; context?: true } & (
  | { kind: 'fill'; role: Role }
  | { kind: 'text' | 'line'; role: Role; ground: Role }
);

// Every role a custom part moves (`generateCustomRoles`), each drawn as the
// app uses it and named by that use. Primary text is also the text on a
// chart cell and an edited row, so it is shown there.
export const SPOTLIGHT: Record<CustomPart, readonly Sample[]> = {
  background: [
    { kind: 'fill', role: 'paper', label: 'Page' },
    { kind: 'fill', role: 'surface', label: 'Card' },
    { kind: 'fill', role: 'viz0', label: 'Empty' },
    // Borders that match the page move with it.
    { kind: 'line', role: 'rule', ground: 'surface', label: 'Border', context: true },
    { kind: 'line', role: 'ruleSoft', ground: 'surface', label: 'Divider', context: true },
  ],
  borders: [
    { kind: 'line', role: 'rule', ground: 'surface', label: 'Border' },
    { kind: 'line', role: 'ruleSoft', ground: 'surface', label: 'Divider' },
    { kind: 'line', role: 'rule', ground: 'paper', label: 'On page' },
  ],
  ink: [
    { kind: 'text', role: 'ink', ground: 'paper', label: 'Page' },
    { kind: 'text', role: 'ink', ground: 'surface', label: 'Card' },
    { kind: 'text', role: 'ink', ground: 'accentWash', label: 'Editing' },
    { kind: 'text', role: 'ink', ground: 'viz4', label: 'Chart' },
    // A light page dims behind a sheet with `ink`.
    { kind: 'fill', role: 'scrim', label: 'Backdrop' },
  ],
  text: [
    { kind: 'text', role: 'inkMuted', ground: 'paper', label: 'Page' },
    { kind: 'text', role: 'inkMuted', ground: 'surface', label: 'Card' },
    { kind: 'text', role: 'inkFaint', ground: 'surface', label: 'Faint' },
    { kind: 'text', role: 'inkGhost', ground: 'surface', label: 'Ghost' },
  ],
  accent: [
    { kind: 'text', role: 'onAccent', ground: 'accent', label: 'Button' },
    { kind: 'text', role: 'accent', ground: 'surface', label: 'Text' },
    { kind: 'text', role: 'accent', ground: 'accentWash', label: 'Editing' },
  ],
  record: [
    { kind: 'text', role: 'record', ground: 'surface', label: 'Text' },
    { kind: 'text', role: 'record', ground: 'recordWash', label: 'Band' },
    { kind: 'line', role: 'recordRule', ground: 'recordWash', label: 'Band line' },
  ],
  viz: [
    { kind: 'fill', role: 'viz0', label: 'Empty', context: true },
    { kind: 'fill', role: 'viz1', label: '1' },
    { kind: 'fill', role: 'viz2', label: '2' },
    { kind: 'fill', role: 'viz3', label: '3' },
    { kind: 'fill', role: 'viz4', label: '4' },
  ],
};

// The part being edited, alone: each role it moves as a tile on the theme's
// page, named by its use. Drawn above the whole mock on the part's page.
export function PartSpotlight({ part, roles, testID }: { part: CustomPart; roles: UiRoles; testID: string }) {
  const type = useUiText();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.page, styles.spotlight, { backgroundColor: roles.paper, borderColor: roles.rule }]}
      testID={testID}>
      {SPOTLIGHT[part].map((sample, index) => (
        <View key={index} style={styles.sample}>
          <View
            style={[styles.tile, { backgroundColor: roles[sample.kind === 'fill' ? sample.role : sample.ground], borderColor: roles.rule }]}
            testID={`${testID}-${index}`}>
            {sample.kind === 'text' ? (
              <Text allowFontScaling={false} style={[type.title, { color: roles[sample.role] }]}>
                Aa
              </Text>
            ) : null}
            {sample.kind === 'line' ? <View style={[styles.line, { backgroundColor: roles[sample.role] }]} /> : null}
          </View>
          <Text allowFontScaling={false} numberOfLines={1} style={[type.meta, { color: roles.inkMuted }]}>
            {sample.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  spotlight: {
    flexDirection: 'row',
  },
  sample: {
    flex: 1,
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  tile: {
    alignSelf: 'stretch',
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.control,
  },
  line: {
    alignSelf: 'stretch',
    height: uiBorder.width,
  },
  page: {
    gap: uiSpace.md,
    padding: uiSpace.md,
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.card,
  },
  card: {
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.card,
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderTopWidth: uiBorder.width,
  },
  setIndex: {
    width: uiSpace.lg,
  },
  figureCell: {
    flex: 1,
  },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderTopWidth: uiBorder.width,
  },
  recordFigure: {
    textAlign: 'right',
  },
  heatmap: {
    flexDirection: 'row',
    gap: uiSpace.xs,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: uiGeometry.radius.control / 2,
  },
  actions: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  button: {
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.control,
  },
  buttonOutline: {
    flex: 1,
    borderWidth: uiBorder.width,
  },
  buttonPrimary: {
    flex: 2,
  },
});
