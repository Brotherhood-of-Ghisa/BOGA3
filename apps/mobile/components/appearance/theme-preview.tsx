import { StyleSheet, Text, View } from 'react-native';

import { FigureText, uiBorder, uiCorner, uiGeometry, uiHairline, uiMark, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
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
      style={[styles.page, { backgroundColor: roles.paper, ...uiHairline(roles, { shape: 'card' }) }]}
      testID={testID}>
      <View style={[styles.card, { backgroundColor: roles.surface, ...uiHairline(roles, { shape: 'card' }) }]}>
        <View style={styles.cardHeader}>
          <Text allowFontScaling={false} style={[type.title, text(roles.ink)]}>
            Bench Press
          </Text>
          <Text allowFontScaling={false} style={[type.meta, text(roles.inkMuted)]}>
            <FigureText>{`1 set · 1RM ${PREVIEW_ONE_REP_MAX.performed}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.setRow, { borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft }]}>
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
        <View style={[styles.setRow, { borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft, backgroundColor: roles.accentWash }]}>
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
        <View style={[styles.record, { backgroundColor: roles.recordWash, borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft }]}>
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
              role === 'viz0' ? uiHairline(roles, { shape: 'control' }) : null,
            ]}
          />
        ))}
      </View>
      <View style={styles.actions}>
        <View style={[styles.button, styles.buttonOutline, { backgroundColor: roles.surface, ...uiHairline(roles, { shape: 'control', tone: 'danger' }) }]}>
          <Text allowFontScaling={false} style={[type.button, text(roles.danger)]}>
            DELETE
          </Text>
        </View>
        <View style={[styles.button, styles.buttonPrimary, uiCorner('control'), { backgroundColor: roles.accent }]}>
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
// hairline, on a ground, or a ramp of fills side by side. A `context` sample
// is another part's role, shown for comparison.
type Sample = { label: string; context?: true } & (
  | { kind: 'fill'; role: Role }
  | { kind: 'text' | 'line'; role: Role; ground: Role }
  | { kind: 'ramp'; roles: readonly Role[] }
);

// The roles a sample draws.
export const sampleRoles = (sample: Sample): Role[] =>
  sample.kind === 'fill' ? [sample.role] : sample.kind === 'ramp' ? [...sample.roles] : [sample.role, sample.ground];

// Every role a custom part moves (`generateCustomRoles`), each drawn as the
// app uses it and named by that use. Primary text is also the text on a
// chart cell and an edited row, so it is shown there. The page draws the
// hairlines and the chart ramp too.
export const SPOTLIGHT: Record<CustomPart, readonly Sample[]> = {
  background: [
    { kind: 'fill', role: 'well', label: 'Track' },
    { kind: 'fill', role: 'paper', label: 'Page' },
    { kind: 'fill', role: 'surface', label: 'Card' },
    { kind: 'fill', role: 'raised', label: 'Field' },
    { kind: 'line', role: 'rule', ground: 'surface', label: 'Border' },
    { kind: 'line', role: 'ruleSoft', ground: 'surface', label: 'Divider' },
    { kind: 'ramp', roles: ['viz0', 'viz1', 'viz2', 'viz3', 'viz4'], label: 'Chart' },
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
  highlight: [
    { kind: 'fill', role: 'accentWash', label: 'Band' },
    { kind: 'text', role: 'ink', ground: 'accentWash', label: 'Text' },
    { kind: 'text', role: 'accent', ground: 'accentWash', label: 'Accent' },
  ],
  record: [
    { kind: 'text', role: 'record', ground: 'surface', label: 'Text' },
    { kind: 'text', role: 'record', ground: 'recordWash', label: 'Band' },
    { kind: 'line', role: 'recordRule', ground: 'recordWash', label: 'Band line' },
  ],
  direction: [
    { kind: 'text', role: 'gain', ground: 'surface', label: 'Up' },
    { kind: 'text', role: 'loss', ground: 'surface', label: 'Down' },
  ],
};

// A sample's tile: its ground, and the text, hairline or ramp drawn on it.
function SampleTile({ sample, roles, testID }: { sample: Sample; roles: UiRoles; testID: string }) {
  const type = useUiText();
  const ground = sample.kind === 'fill' ? sample.role : sample.kind === 'ramp' ? sample.roles[0] : sample.ground;
  return (
    <View style={[styles.tile, sample.kind === 'ramp' ? styles.ramp : null, { backgroundColor: roles[ground], ...uiHairline(roles, { shape: 'control' }) }]} testID={testID}>
      {sample.kind === 'text' ? (
        <Text allowFontScaling={false} style={[type.title, { color: roles[sample.role] }]}>
          Aa
        </Text>
      ) : null}
      {sample.kind === 'line' ? <View style={[styles.line, { backgroundColor: roles[sample.role] }]} /> : null}
      {sample.kind === 'ramp'
        ? sample.roles.slice(1).map((role) => <View key={role} style={[styles.rampStep, { backgroundColor: roles[role] }]} />)
        : null}
    </View>
  );
}

// The part being edited, alone: each role it moves as a tile on the theme's
// page, named by its use. Drawn above the whole mock on the part's page.
export function PartSpotlight({ part, roles, testID }: { part: CustomPart; roles: UiRoles; testID: string }) {
  const type = useUiText();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.page, styles.spotlight, { backgroundColor: roles.paper, ...uiHairline(roles, { shape: 'card' }) }]}
      testID={testID}>
      {SPOTLIGHT[part].map((sample, index) => (
        <View key={index} style={styles.sample}>
          <SampleTile roles={roles} sample={sample} testID={`${testID}-${index}`} />
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
  },
  line: {
    alignSelf: 'stretch',
    height: uiBorder.width,
  },
  // The ramp's empty cell is the tile; its steps stand in it, weakest first.
  ramp: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.xs,
    padding: uiSpace.xs,
  },
  rampStep: {
    flex: 1,
  },
  page: {
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  card: {
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
    ...uiMark.bar,
  },
  actions: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  button: {
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOutline: {
    flex: 1,
  },
  buttonPrimary: {
    flex: 2,
  },
});
