import { useId, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, Path, Use } from 'react-native-svg';

import {
  Card,
  FigureText,
  Icon,
  Information,
  ListRow,
  SegmentedControl,
  Sheet,
  uiRoles,
  uiSpace,
  uiText,
  uiTextTone,
  type SegmentedControlOption,
} from '@/components/ui';
import { useNovemberAppearance } from '@/components/appearance/use-november-appearance';
import type { ProgressMuscleComparison } from '@/src/data';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import { COLUMN_LABELS, ComparisonValues, comparisonFigures, metricUnit } from './comparison-columns';
import {
  bodyOrientationForAngle,
  buildThemeShadePalette,
  canonicalOrientationForMuscle,
  computeMuscleScores,
  hitTestProjectedMuscle,
  normaliseBodyAngle,
  projectMuscleBody,
  selectMuscleFibres,
  type BodyOrientation,
} from './muscle-body-projection';

type Props = {
  readonly muscles: readonly ProgressMuscleComparison[];
  readonly metric: ProgressMetric;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** The user's muscle setup, so merged entries shade and select together and untracked ones stay neutral. */
  readonly report?: MuscleReportAssignment;
};

const ORIENTATION_OPTIONS: readonly SegmentedControlOption<BodyOrientation>[] = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
];

const VIEWPORT_HEIGHT = 280;
const MIN_VIEWPORT_WIDTH = 220;
const CARD_HORIZONTAL_INSET = uiSpace.lg * 4;
const PAN_ACTIVATION_X = 8;
const PAN_FAIL_Y = 12;
const DEGREES_PER_POINT = 0.85;
const ACCESSIBILITY_ANGLE_STEP = 30;
const FACET_STROKE_WIDTH = 0.35;

const LEGACY_REVERSE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  delts_front: ['delts_front', 'front_delts'],
  delts_lateral: ['delts_lateral', 'side_delts'],
  delts_rear: ['delts_rear', 'rear_delts'],
};

const resolveDatasetMuscleId = (
  canonicalId: string,
  muscles: readonly ProgressMuscleComparison[]
): string => {
  if (muscles.some(row => row.muscleGroupId === canonicalId)) {
    return canonicalId;
  }
  const candidates = LEGACY_REVERSE_ALIASES[canonicalId] ?? [];
  const match = muscles.find(row => candidates.includes(row.muscleGroupId));
  return match ? match.muscleGroupId : canonicalId;
};

type HeaderProps = {
  readonly orientation: BodyOrientation;
  readonly onOrientationChange: (next: BodyOrientation) => void;
  readonly selectedMuscle: ProgressMuscleComparison | null;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onOpenPicker: () => void;
};

function MuscleBodyHeader({
  orientation,
  onOrientationChange,
  selectedMuscle,
  onPrev,
  onNext,
  onOpenPicker,
}: HeaderProps) {
  return (
    <View style={styles.headerRow}>
      <SegmentedControl
        accessibilityLabel="Body orientation"
        density="compact"
        layout="inline"
        onChange={onOrientationChange}
        options={ORIENTATION_OPTIONS}
        selectedGround="selection"
        testIDPrefix="stats-muscle-body-angle"
        value={orientation}
      />
      <View style={styles.stepperContainer}>
        <Pressable
          accessibilityLabel="Previous muscle"
          accessibilityRole="button"
          hitSlop={uiSpace.sm}
          onPress={onPrev}
          style={styles.stepperButton}
          testID="stats-muscle-body-prev">
          <Icon name="chevron-left" size="sm" />
        </Pressable>
        <Pressable
          accessibilityHint="Opens muscle list sheet"
          accessibilityLabel={`Selected muscle: ${selectedMuscle?.displayName ?? 'None'}. Tap to choose another muscle.`}
          accessibilityRole="button"
          hitSlop={uiSpace.xs}
          onPress={onOpenPicker}
          style={styles.pickerTrigger}
          testID="stats-muscle-body-picker-trigger">
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[uiText.label, uiTextTone.ink]}
            testID="stats-muscle-body-selected">
            {selectedMuscle?.displayName ?? 'Select'}
          </Text>
          <Icon name="chevron-down" size="xs" />
        </Pressable>
        <Pressable
          accessibilityLabel="Next muscle"
          accessibilityRole="button"
          hitSlop={uiSpace.sm}
          onPress={onNext}
          style={styles.stepperButton}
          testID="stats-muscle-body-next">
          <Icon name="chevron-right" size="sm" />
        </Pressable>
      </View>
    </View>
  );
}

type PickerSheetProps = {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  readonly muscles: readonly ProgressMuscleComparison[];
  readonly metric: ProgressMetric;
  readonly selectedId: string | null;
  readonly onSelectMuscle: (id: string) => void;
};

function MusclePickerSheet({
  visible,
  onDismiss,
  muscles,
  metric,
  selectedId,
  onSelectMuscle,
}: PickerSheetProps) {
  const unit = metricUnit(metric);
  return (
    <Sheet
      dismissLabel="Dismiss muscle picker"
      onDismiss={onDismiss}
      testID="stats-muscle-picker-sheet"
      title="Select Muscle"
      visible={visible}>
      <ScrollView contentContainerStyle={styles.sheetList} style={styles.sheetScroll}>
        {muscles.map(row => {
          const isSelected = row.muscleGroupId === selectedId;
          const figures = comparisonFigures(row, metric);
          return (
            <ListRow
              accessibilityHint="Selects this muscle on the 3D model"
              accessibilityLabel={`${row.displayName}. Now ${figures.now}, previous ${figures.previous}, change ${figures.change.text}. ${unit}.`}
              density="sheet"
              key={row.muscleGroupId}
              onPress={() => onSelectMuscle(row.muscleGroupId)}
              selected={isSelected}
              testID={`stats-muscle-picker-row-${row.muscleGroupId}`}
              trailing={isSelected ? <Icon name="check" size="md" /> : undefined}>
              <View style={styles.sheetRowContent}>
                <Text
                  allowFontScaling={false}
                  style={[uiText.bodyStrong, isSelected && uiTextTone.accent]}>
                  {row.displayName}
                </Text>
                <Text allowFontScaling={false} style={uiText.meta}>
                  <FigureText>{`${figures.now} ${unit}`}</FigureText>
                </Text>
              </View>
            </ListRow>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

function MuscleAccessibilityTargets({ muscles, metric, selectedId, onSelect }: Props) {
  const unit = metricUnit(metric);
  return (
    <View
      pointerEvents="box-none"
      style={styles.srTargets}
      testID="stats-muscle-body-targets">
      {muscles.map(row => {
        const figures = comparisonFigures(row, metric);
        const selected = row.muscleGroupId === selectedId;
        return (
          <Pressable
            accessibilityHint="Selects muscle on the 3D body model."
            accessibilityLabel={`Select ${row.displayName}. Now ${figures.now}, previous ${figures.previous}, change ${figures.change.text}. ${unit}.`}
            accessibilityRole="button"
            accessibilityState={{ selected, expanded: selected }}
            key={row.muscleGroupId}
            onPress={() => onSelect(row.muscleGroupId)}
            style={styles.srTarget}
            testID={`stats-muscle-body-target-${row.muscleGroupId}`}
          />
        );
      })}
    </View>
  );
}

/**
 * Interactive 3D low-poly anatomical muscle model for the Progress Muscle breakdown.
 * Colours follow [[comparison.colour-scale]], with CIE LCh lighting,
 * supports horizontal drag-to-rotate across 360° plus Front/Back toggle,
 * and selects a muscle group on tap. Selected schematic fibres reveal
 * full source-shape extents through covering anatomy, with provisional registration;
 * independent normals hide their own far surface. Body colours and hit targets stay live.
 * Decoration follows [[appearance.november]] without changing hit testing.
 */
export function MuscleBodyCard({ muscles, metric, selectedId, onSelect, report }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const november = useNovemberAppearance();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [baseAngleDeg, setBaseAngleDeg] = useState(0);
  const [dragOffsetDeg, setDragOffsetDeg] = useState(0);

  const angleDeg = normaliseBodyAngle(baseAngleDeg + dragOffsetDeg);

  const viewportWidth =
    measuredWidth > 0
      ? measuredWidth
      : Math.max(MIN_VIEWPORT_WIDTH, windowWidth - CARD_HORIZONTAL_INSET);

  const orientation = bodyOrientationForAngle(angleDeg);
  const scores = useMemo(() => computeMuscleScores(muscles, metric), [muscles, metric]);
  const palette = useMemo(() => buildThemeShadePalette(uiRoles), []);
  const selectedFibres = useMemo(() => selectMuscleFibres(selectedId, report), [selectedId, report]);
  const projected = useMemo(
    () =>
      projectMuscleBody({
        angleDeg,
        width: viewportWidth,
        height: VIEWPORT_HEIGHT,
        scores,
        selectedId,
        selectedFibres,
        report,
        palette,
        november,
      }),
    [angleDeg, scores, palette, report, selectedId, selectedFibres, viewportWidth, november]
  );

  const selectedMuscle = useMemo(
    () => (selectedId ? muscles.find(row => row.muscleGroupId === selectedId) ?? null : null),
    [muscles, selectedId]
  );

  const [sheetVisible, setSheetVisible] = useState(false);

  const selectWithAutoOrientation = (targetId: string) => {
    onSelect(targetId);
    const targetOrientation = canonicalOrientationForMuscle(targetId);
    if (targetOrientation !== orientation) {
      setDragOffsetDeg(0);
      setBaseAngleDeg(targetOrientation === 'front' ? 0 : 180);
    }
  };

  const handleNextMuscle = () => {
    if (muscles.length === 0) return;
    const currentIndex = muscles.findIndex(row => row.muscleGroupId === selectedId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % muscles.length;
    selectWithAutoOrientation(muscles[nextIndex].muscleGroupId);
  };

  const handlePrevMuscle = () => {
    if (muscles.length === 0) return;
    const currentIndex = muscles.findIndex(row => row.muscleGroupId === selectedId);
    const prevIndex =
      currentIndex < 0 ? muscles.length - 1 : (currentIndex - 1 + muscles.length) % muscles.length;
    selectWithAutoOrientation(muscles[prevIndex].muscleGroupId);
  };

  const handleTapPoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const hit = hitTestProjectedMuscle(projected, x, y);
    if (hit) {
      onSelect(resolveDatasetMuscleId(hit, muscles));
    }
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-PAN_ACTIVATION_X, PAN_ACTIVATION_X])
    .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
    .onUpdate(event => {
      setDragOffsetDeg(event.translationX * DEGREES_PER_POINT);
    })
    .onEnd(event => {
      setBaseAngleDeg(current =>
        normaliseBodyAngle(current + event.translationX * DEGREES_PER_POINT)
      );
      setDragOffsetDeg(0);
    })
    .onFinalize(() => {
      setDragOffsetDeg(0);
    });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDistance(PAN_ACTIVATION_X)
    .onEnd(event => {
      handleTapPoint(event.x, event.y);
    });

  const gesture = Gesture.Exclusive(pan, tap);

  return (
    <Card style={styles.card} testID="stats-muscle-body-card">
      <MuscleBodyHeader
        onNext={handleNextMuscle}
        onOpenPicker={() => setSheetVisible(true)}
        onOrientationChange={next => {
          setDragOffsetDeg(0);
          setBaseAngleDeg(next === 'front' ? 0 : 180);
        }}
        onPrev={handlePrevMuscle}
        orientation={orientation}
        selectedMuscle={selectedMuscle}
      />
      <View>
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            accessibilityLabel="Muscle body model"
            accessibilityRole="adjustable"
            accessibilityValue={{
              text: `${orientation === 'front' ? 'Front' : 'Back'} view, ${angleDeg} degrees`,
            }}
            onAccessibilityAction={event => {
              const delta =
                event.nativeEvent.actionName === 'increment'
                  ? ACCESSIBILITY_ANGLE_STEP
                  : -ACCESSIBILITY_ANGLE_STEP;
              setDragOffsetDeg(0);
              setBaseAngleDeg(current => normaliseBodyAngle(current + delta));
            }}
            onLayout={event => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);
              if (nextWidth > 0 && nextWidth !== measuredWidth) {
                setMeasuredWidth(nextWidth);
              }
            }}
            style={styles.viewport}
            testID="stats-muscle-body-viewport">
            <Svg
              height={VIEWPORT_HEIGHT}
              pointerEvents="none"
              testID="stats-muscle-body-svg"
              width={viewportWidth}>
              {projected.batches.map(batch => (
                <Path
                  d={batch.d}
                  fill={batch.fill}
                  key={batch.key}
                  stroke={batch.fill}
                  strokeLinejoin="round"
                  strokeWidth={FACET_STROKE_WIDTH}
                />
              ))}
              {(['surface', 'deep'] as const).map(layer => projected.fibres[layer] ? (
                <ReliefFibres key={layer} d={projected.fibres[layer]} layer={layer} />
              ) : null)}
              {projected.fibres.anatomicalParts?.map(part => part.d ? (
                <ReliefFibres key={part.id} d={part.d} layer="deep" id={`anatomy-${part.id}`} />
              ) : null)}
            </Svg>
          </View>
        </GestureDetector>
        <View style={styles.information}>
          <Information title="About the muscle model" testIDPrefix="stats-muscle-body"
            body="Fibre directions are schematic, not measured anatomy. Selected guides reveal the full muscle shape through covering muscles as you rotate. Anatomical shapes are provisionally aligned to this model."
            sections={[[ 'Anatomical source', 'BodyParts3D © The Database Center for Life Science, CC BY 4.0. Adapted by pose alignment, bilateral mirroring and schematic fibre generation. Source and licence: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html' ]]} />
        </View>
      </View>
      {selectedMuscle ? <View testID="stats-muscle-body-comparison">
        <View style={styles.comparisonLabels}>
          {COLUMN_LABELS.map(label => <Text key={label} allowFontScaling={false}
            style={[uiText.label, uiTextTone.muted, { width: (viewportWidth - uiSpace.sm * 2) / 3, textAlign: 'right' }]}>{label}</Text>)}
        </View>
        <ComparisonValues row={selectedMuscle} metric={metric} prefix="stats-muscle-body-comparison"
          layout={{ columns: Array(3).fill((viewportWidth - uiSpace.sm * 2) / 3), stacked: false }} />
      </View> : null}
      <MuscleAccessibilityTargets
        metric={metric}
        muscles={muscles}
        onSelect={onSelect}
        selectedId={selectedId}
      />
      <MusclePickerSheet
        metric={metric}
        muscles={muscles}
        onDismiss={() => setSheetVisible(false)}
        onSelectMuscle={targetId => {
          setSheetVisible(false);
          selectWithAutoOrientation(targetId);
        }}
        selectedId={selectedId}
        visible={sheetVisible}
      />
    </Card>
  );
}

function ReliefFibres({ d, layer, id = layer }: { d: string; layer: 'surface' | 'deep'; id?: string }) {
  const definitionId = useId();
  // Share native path parsing and stroked bounds between the ordered relief paints.
  // Transparent fill and stroke alpha avoid native outline clips and offscreen opacity layers.
  return <>
    <Defs><Path id={definitionId} d={d} /></Defs>
    <Use href={`#${definitionId}`} fill="transparent" stroke={uiRoles.surface} strokeWidth={1.1} strokeOpacity={0.95}
      translateX={0.45} translateY={-0.45} strokeLinecap="round" strokeLinejoin="round"
      testID={`stats-muscle-body-fibres-${id}-highlight`} />
    <Use href={`#${definitionId}`} fill="transparent" stroke={uiRoles.inkMuted} strokeWidth={0.9}
      strokeOpacity={layer === 'surface' ? 0.72 : 0.70} strokeLinecap="round" strokeLinejoin="round"
      testID={`stats-muscle-body-fibres-${id}-shade`} />
  </>;
}

const styles = StyleSheet.create({
  information: { position: 'absolute', top: 0, right: 0 },
  comparisonLabels: { flexDirection: 'row', gap: uiSpace.sm },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    maxWidth: '65%',
  },
  stepperButton: {
    padding: uiSpace.xs,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
    minHeight: 28,
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.xs,
    paddingVertical: uiSpace.xs,
    maxWidth: 160,
  },
  sheetScroll: {
    maxHeight: 460,
  },
  sheetList: {
    paddingBottom: uiSpace.lg,
  },
  sheetRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: uiSpace.sm,
  },
  viewport: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: VIEWPORT_HEIGHT,
  },
  srTargets: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  srTarget: {
    width: 1,
    height: 1,
  },
});
