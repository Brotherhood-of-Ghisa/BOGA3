import { StyleSheet, Text, View } from 'react-native';

import { FigureText, uiBorder, uiFonts, uiGeometry, uiSpace, uiText, uiTextTone, uiTypography } from '@/components/ui';
import type { UiRoles } from '@/components/ui/theme';
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

// A small mock of the app drawn in another theme's roles: the screens bake
// this launch's `uiRoles` in, so the preview cannot reuse them. Every colour
// here comes from `roles`; the layout comes from the shared tokens.
export function ThemePreview({ roles, testID }: ThemePreviewProps) {
  const text = (colour: string) => ({ color: colour });
  return (
    <View
      accessibilityLabel="Preview of the theme"
      importantForAccessibility="no-hide-descendants"
      style={[styles.page, { backgroundColor: roles.paper, borderColor: roles.rule }]}
      testID={testID}>
      <View style={[styles.card, { backgroundColor: roles.surface, borderColor: roles.rule }]}>
        <View style={styles.cardHeader}>
          <Text allowFontScaling={false} style={[uiText.title, text(roles.ink)]}>
            Bench Press
          </Text>
          <Text allowFontScaling={false} style={[uiText.meta, text(roles.inkMuted)]}>
            <FigureText>{`1 set · 1RM ${PREVIEW_ONE_REP_MAX.performed}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.setRow, { borderTopColor: roles.ruleSoft }]}>
          <Text allowFontScaling={false} style={[uiText.figure, styles.setIndex, text(roles.inkFaint)]}>
            1
          </Text>
          <Text allowFontScaling={false} style={[uiText.figure, styles.figureCell, text(roles.ink)]}>
            80 × 8
          </Text>
          <Text allowFontScaling={false} style={[uiText.meta, text(roles.inkFaint)]}>
            <FigureText>{`1RM ${PREVIEW_ONE_REP_MAX.performed}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.setRow, { borderTopColor: roles.ruleSoft, backgroundColor: roles.accentWash }]}>
          <Text allowFontScaling={false} style={[uiText.figure, styles.setIndex, text(roles.accent)]}>
            2
          </Text>
          <Text allowFontScaling={false} style={[uiText.figure, styles.figureCell, text(roles.ink)]}>
            82.5 × 8
          </Text>
          <Text allowFontScaling={false} style={[uiText.meta, text(roles.inkGhost)]}>
            <FigureText>{`1RM ${PREVIEW_ONE_REP_MAX.planned}`}</FigureText>
          </Text>
        </View>
        <View style={[styles.record, { backgroundColor: roles.recordWash, borderTopColor: roles.recordRule }]}>
          <Text allowFontScaling={false} style={[uiText.label, text(roles.record)]}>
            BEST EVER
          </Text>
          <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.record, styles.figureCell, styles.recordFigure, text(roles.record)]}>
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
          <Text allowFontScaling={false} style={[styles.buttonLabel, text(roles.danger)]}>
            DELETE
          </Text>
        </View>
        <View style={[styles.button, styles.buttonPrimary, { backgroundColor: roles.accent }]}>
          <Text allowFontScaling={false} style={[styles.buttonLabel, text(roles.surface)]}>
            LOG SET
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  buttonLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
  },
});
