import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { HeatmapLegend } from '@/components/heatmaps/HeatmapLegend';
import {
  Card,
  SegmentedControl,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
  type SegmentedControlOption,
} from '@/components/ui';
import type { ProgressMuscleComparison } from '@/src/data';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import { comparisonFigures, metricUnit } from './comparison-columns';
import {
  bodyOrientationForAngle,
  buildThemeShadePalette,
  computeMuscleBuckets,
  hitTestProjectedMuscle,
  normaliseBodyAngle,
  projectMuscleBody,
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
            accessibilityLabel={`Select ${row.displayName}. Now ${figures.now} ${unit}.`}
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
 * Colours each muscle group from the active theme's sequential `viz0..viz4` ramp
 * in CIE LCh, supports horizontal drag-to-rotate across 360° plus Front/Back toggle,
 * and selects/deselects a muscle group on tap.
 */
export function MuscleBodyCard({ muscles, metric, selectedId, onSelect, report }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [baseAngleDeg, setBaseAngleDeg] = useState(0);
  const [dragOffsetDeg, setDragOffsetDeg] = useState(0);

  const angleDeg = normaliseBodyAngle(baseAngleDeg + dragOffsetDeg);

  const viewportWidth =
    measuredWidth > 0
      ? measuredWidth
      : Math.max(MIN_VIEWPORT_WIDTH, windowWidth - CARD_HORIZONTAL_INSET);

  const orientation = bodyOrientationForAngle(angleDeg);
  const buckets = useMemo(() => computeMuscleBuckets(muscles, metric), [muscles, metric]);
  const palette = useMemo(() => buildThemeShadePalette(uiRoles), []);
  const projected = useMemo(
    () =>
      projectMuscleBody({
        angleDeg,
        width: viewportWidth,
        height: VIEWPORT_HEIGHT,
        buckets,
        selectedId,
        report,
        palette,
      }),
    [angleDeg, buckets, palette, report, selectedId, viewportWidth]
  );

  const selectedMuscle = useMemo(
    () => (selectedId ? muscles.find(row => row.muscleGroupId === selectedId) ?? null : null),
    [muscles, selectedId]
  );

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
      <View style={styles.headerRow}>
        <SegmentedControl
          accessibilityLabel="Body orientation"
          density="compact"
          layout="inline"
          onChange={next => {
            setDragOffsetDeg(0);
            setBaseAngleDeg(next === 'front' ? 0 : 180);
          }}
          options={ORIENTATION_OPTIONS}
          selectedGround="selection"
          testIDPrefix="stats-muscle-body-angle"
          value={orientation}
        />
        {selectedMuscle ? (
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={styles.selectedName}
            testID="stats-muscle-body-selected">
            {selectedMuscle.displayName}
          </Text>
        ) : null}
      </View>
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
                strokeWidth={batch.selected ? 0.55 : 0.35}
              />
            ))}
          </Svg>
        </View>
      </GestureDetector>
      <MuscleAccessibilityTargets
        metric={metric}
        muscles={muscles}
        onSelect={onSelect}
        selectedId={selectedId}
      />
      <HeatmapLegend label={metric === 'workingSetCount' ? 'Sets per muscle' : 'Volume per muscle'} />
    </Card>
  );
}

const styles = StyleSheet.create({
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
  selectedName: {
    flex: 1,
    textAlign: 'right',
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
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
