import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
  ActionButton,
  Card,
  FigureText,
  Icon,
  Information,
  ListRow,
  SegmentedControl,
  Sheet,
  StatePanel,
  uiSpace,
  useUiMode,
  useUiRoles,
  type SegmentedControlOption,
} from '@/components/ui';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { useNovemberAppearance } from '@/components/appearance/use-november-appearance';
import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import Svg, { Path } from 'react-native-svg';
import { InjuryBadge } from '@/components/injuries/injury-badge';
import type { ProgressMuscleComparison } from '@/src/data';
import type { InjuryView } from '@/src/data/injuries';
import { resolveInjuryMuscleGroupId } from '@/src/injuries/injury-warning-engine';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import { COLUMN_LABELS, ComparisonValues, comparisonFigures, metricUnit } from './comparison-columns';
import {
  bodyOrientationForAngle,
  buildThemeShadePalette,
  canonicalOrientationForMuscle,
  computeMuscleScores,
  INJURY_STATUS_PRIORITY,
  normaliseBodyAngle,
  projectMuscleBody,
  type ActiveInjuryOverlay,
  type BodyOrientation,
  type MuscleOverlayStyle,
  type MuscleSetTargets,
  type ProjectedMuscleBody,
} from './muscle-body-projection';
import { MuscleBodyCanvas } from './muscle-body-canvas';
import type { WireframeFrame } from './muscle-wireframe-renderer';
import { hitWireframe, selectMuscleMeshes, wireframeCamera } from './muscle-wireframe-scene';

type Props = {
  readonly muscles: readonly ProgressMuscleComparison[];
  readonly metric: ProgressMetric;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** The user's muscle setup, so merged entries shade and select together and untracked ones stay neutral. */
  readonly report?: MuscleReportAssignment;
  readonly setTargets?: MuscleSetTargets;
  readonly defaultOverlay?: MuscleOverlayStyle;
  readonly overlay?: MuscleOverlayStyle;
  readonly onOverlayChange?: (next: MuscleOverlayStyle) => void;
  readonly activeInjuries?: readonly (ActiveInjuryOverlay | InjuryView)[];
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

type HeaderProps = {
  readonly orientation: BodyOrientation;
  readonly onOrientationChange: (next: BodyOrientation) => void;
  readonly overlay: MuscleOverlayStyle;
  readonly onOverlayChange: (next: MuscleOverlayStyle) => void;
  readonly selectedMuscle: ProgressMuscleComparison | null;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onOpenPicker: () => void;
};

function MuscleBodyHeader({
  orientation,
  onOrientationChange,
  overlay,
  onOverlayChange,
  selectedMuscle,
  onPrev,
  onNext,
  onOpenPicker,
}: HeaderProps) {
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <View style={styles.headerRow}>
      <View style={styles.controlsLeft}>
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
        <ActionButton
          accessibilityHint="Switches between wireframe and filled patch views"
          accessibilityLabel={`Muscle overlay: ${overlay === 'contour' ? 'Patches' : 'Wireframe'}`}
          label={overlay === 'contour' ? 'Patches' : 'Wireframe'}
          onPress={() => onOverlayChange(overlay === 'contour' ? 'wireframe' : 'contour')}
          size="compact"
          variant="outline"
          testID="stats-muscle-body-overlay-toggle"
        />
      </View>
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
            style={[text.label, tone.ink]}
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
  const text = useUiText();
  const tone = useUiTextTone();
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
                  style={[text.bodyStrong, isSelected && tone.accent]}>
                  {row.displayName}
                </Text>
                <Text allowFontScaling={false} style={text.meta}>
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

function MuscleAccessibilityTargets({ muscles, metric, selectedId, onSelect, activeInjuries }: Props) {
  const unit = metricUnit(metric);
  return (
    <View
      pointerEvents="box-none"
      style={styles.srTargets}
      testID="stats-muscle-body-targets">
      {muscles.map(row => {
        const figures = comparisonFigures(row, metric);
        const selected = row.muscleGroupId === selectedId;
        const matchingInjuries = activeInjuries
          ?.filter(
            i =>
              i.status !== 'resolved' &&
              (i.muscleGroupId === row.muscleGroupId ||
                resolveInjuryMuscleGroupId({
                  muscleGroupId: i.muscleGroupId ?? null,
                  label: i.label ?? '',
                }) === row.muscleGroupId)
          )
          .sort(
            (a, b) =>
              (INJURY_STATUS_PRIORITY[a.status] ?? 99) -
              (INJURY_STATUS_PRIORITY[b.status] ?? 99)
          );
        const injuryNotice = matchingInjuries && matchingInjuries.length > 0
          ? ` Active injury: ${matchingInjuries.map(i => `${i.status} ${i.label ?? ''}`).join(', ')}.`
          : '';
        return (
          <Pressable
            accessibilityHint="Selects muscle on the 3D body model."
            accessibilityLabel={`Select ${row.displayName}.${injuryNotice} Now ${figures.now}, previous ${figures.previous}, change ${figures.change.text}. ${unit}.`}
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

type InjuryOverlaysProps = {
  readonly projected: ProjectedMuscleBody;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly onSelectMuscle: (id: string) => void;
};

function MuscleInjuryOverlays({
  projected,
  viewportWidth,
  viewportHeight,
  onSelectMuscle,
}: InjuryOverlaysProps) {
  const hasContours = projected.injuryContours && projected.injuryContours.length > 0;
  const hasBadges = projected.injuryBadges && projected.injuryBadges.some(b => b.visible);
  if (!hasContours && !hasBadges) return null;

  return (
    <>
      {hasContours ? (
        <Svg
          height={viewportHeight}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          testID="stats-muscle-injury-contours"
          width={viewportWidth}>
          {projected.injuryContours!.map((contour, i) => (
            <Path
              d={contour.d}
              fill="none"
              key={`injury-contour-${contour.injuryId}-${i}`}
              stroke={contour.stroke}
              strokeWidth={contour.status === 'acute' ? 2.5 : 1.6}
            />
          ))}
        </Svg>
      ) : null}
      {projected.injuryBadges?.map(badge => {
        const severityZIndex = badge.status === 'acute' ? 30 : badge.status === 'managing' ? 20 : 10;
        return badge.visible ? (
          <View
            key={`injury-badge-${badge.injuryId}`}
            pointerEvents="box-none"
            style={[
              styles.injuryBadgeAnchor,
              {
                left: Math.max(8, Math.min(viewportWidth - 76, badge.x - 30)),
                top: Math.max(8, Math.min(viewportHeight - 24, badge.y - 12)),
                zIndex: severityZIndex,
              },
            ]}>
            <InjuryBadge
              onPress={() => onSelectMuscle(badge.muscleGroupId)}
              severity={badge.status}
              testID={`stats-muscle-injury-badge-${badge.injuryId}`}
            />
          </View>
        ) : null;
      })}
    </>
  );
}

type ViewportAreaProps = {
  readonly canvasFailed: boolean;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
  readonly onRetry: () => void;
  readonly gesture: ReturnType<typeof Gesture.Exclusive>;
  readonly orientation: BodyOrientation;
  readonly angleDeg: number;
  readonly onAccessibilityAction: (delta: number) => void;
  readonly onLayoutWidth: (width: number) => void;
  readonly wireframe: WireframeFrame;
  readonly onCanvasError: () => void;
  readonly projected: ProjectedMuscleBody;
  readonly onSelectMuscle: (id: string) => void;
};

function MuscleBodyViewportArea({
  canvasFailed,
  viewportHeight,
  viewportWidth,
  onRetry,
  gesture,
  orientation,
  angleDeg,
  onAccessibilityAction,
  onLayoutWidth,
  wireframe,
  onCanvasError,
  projected,
  onSelectMuscle,
}: ViewportAreaProps) {
  if (canvasFailed) {
    return (
      <View style={[styles.viewport, { height: viewportHeight }]} testID="stats-muscle-body-viewport">
        <StatePanel
          action={{ label: 'Retry', testID: 'stats-muscle-wireframe-retry', onPress: onRetry }}
          kind="error"
          testID="stats-muscle-wireframe-error"
          title="Muscle model unavailable"
        />
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel="Muscle body model"
        accessibilityRole="adjustable"
        accessibilityValue={{
          text: `${orientation === 'front' ? 'Front' : 'Back'} view, ${angleDeg} degrees`,
        }}
        accessible
        onAccessibilityAction={event => {
          const delta =
            event.nativeEvent.actionName === 'increment'
              ? ACCESSIBILITY_ANGLE_STEP
              : -ACCESSIBILITY_ANGLE_STEP;
          onAccessibilityAction(delta);
        }}
        onLayout={event => {
          const nextWidth = Math.round(event.nativeEvent.layout.width);
          if (nextWidth > 0) onLayoutWidth(nextWidth);
        }}
        style={[styles.viewport, { height: viewportHeight }]}
        testID="stats-muscle-body-viewport">
        <MuscleBodyCanvas frame={wireframe} onError={onCanvasError} />
        <MuscleInjuryOverlays
          onSelectMuscle={onSelectMuscle}
          projected={projected}
          viewportHeight={viewportHeight}
          viewportWidth={viewportWidth}
        />
      </View>
    </GestureDetector>
  );
}

type ComparisonSectionProps = {
  readonly selectedMuscle: ProgressMuscleComparison;
  readonly metric: ProgressMetric;
  readonly viewportWidth: number;
};

function MuscleBodyComparison({ selectedMuscle, metric, viewportWidth }: ComparisonSectionProps) {
  const text = useUiText();
  const tone = useUiTextTone();
  const colWidth = (viewportWidth - uiSpace.sm * 2) / 3;
  return (
    <View testID="stats-muscle-body-comparison">
      <View style={styles.comparisonLabels}>
        {COLUMN_LABELS.map(label => (
          <Text
            key={label}
            allowFontScaling={false}
            style={[text.label, tone.muted, { width: colWidth, textAlign: 'right' }]}>
            {label}
          </Text>
        ))}
      </View>
      <ComparisonValues
        layout={{ columns: Array(3).fill(colWidth), stacked: false }}
        metric={metric}
        prefix="stats-muscle-body-comparison"
        row={selectedMuscle}
      />
    </View>
  );
}

/**
 * Interactive 3D low-poly anatomical muscle model for the Progress Muscle breakdown.
 * Colours follow [[comparison.colour-scale]], with CIE LCh lighting,
 * supports horizontal drag-to-rotate across 360° plus Front/Back toggle,
 * and selects a reported muscle group on tap. Wireframe uses depth-tested mesh
 * edges on an opaque grey body; selected anatomy fades through covering muscle layers with
 * a distinct colour and light fill. Filled patches share the coarse anatomy,
 * camera, focus and hit testing; switching view changes only its material.
 * Decoration follows [[appearance.november]] without changing hit testing.
 */
export function MuscleBodyCard({
  muscles,
  metric,
  selectedId,
  onSelect,
  report,
  setTargets,
  defaultOverlay = 'wireframe',
  overlay: controlledOverlay,
  onOverlayChange,
  activeInjuries,
}: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const november = useNovemberAppearance();
  const roles = useUiRoles();
  const mode = useUiMode();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [baseAngleDeg, setBaseAngleDeg] = useState(0);
  const [dragOffsetDeg, setDragOffsetDeg] = useState(0);
  const [internalOverlay, setInternalOverlay] = useState<MuscleOverlayStyle>(defaultOverlay);
  const [canvasFailed, setCanvasFailed] = useState(false);

  const overlay = controlledOverlay ?? internalOverlay;

  const handleOverlayChange = (next: MuscleOverlayStyle) => {
    setCanvasFailed(false);
    setInternalOverlay(next);
    onOverlayChange?.(next);
  };

  const [focus, setFocus] = useState(false);
  // Leave room for Progress controls, comparison and the tab bar on compact phones.
  const viewportHeight = Math.min(420, Math.max(VIEWPORT_HEIGHT, windowHeight - 440));
  const angleDeg = normaliseBodyAngle(baseAngleDeg + dragOffsetDeg);

  const viewportWidth =
    measuredWidth > 0
      ? measuredWidth
      : Math.max(MIN_VIEWPORT_WIDTH, windowWidth - CARD_HORIZONTAL_INSET);

  const orientation = bodyOrientationForAngle(angleDeg);
  const scores = useMemo(() => computeMuscleScores(muscles, metric, setTargets), [muscles, metric, setTargets]);
  const palette = useMemo(() => buildThemeShadePalette(roles, mode), [roles, mode]);
  const selectedMeshes = useMemo(() => selectMuscleMeshes(selectedId, report, focus), [selectedId, report, focus]);
  const camera = useMemo(() => wireframeCamera({ angle: angleDeg, width: viewportWidth, height: viewportHeight,
    selected: selectedMeshes, focus }), [angleDeg, viewportWidth, viewportHeight, selectedMeshes, focus]);
  const wireframe = useMemo(() => ({ overlay, camera, selected: selectedMeshes, scores, report, palette, roles, november }),
    [overlay, camera, selectedMeshes, scores, report, palette, roles, november]);

  const activeInjuryOverlays = useMemo<readonly ActiveInjuryOverlay[] | undefined>(() => {
    if (!activeInjuries || activeInjuries.length === 0) return undefined;
    return activeInjuries.map(injury => ({
      id: injury.id,
      muscleGroupId: injury.muscleGroupId ?? null,
      side: injury.side ?? null,
      status: injury.status,
      painScore: injury.painScore ?? null,
      label: injury.label,
    }));
  }, [activeInjuries]);

  const projected = useMemo(
    () =>
      projectMuscleBody({
        angleDeg,
        width: viewportWidth,
        height: viewportHeight,
        scores,
        selectedId,
        report,
        palette,
        overlay,
        activeInjuries: activeInjuryOverlays,
      }),
    [angleDeg, viewportWidth, viewportHeight, scores, selectedId, report, palette, overlay, activeInjuryOverlays]
  );

  const selectedMuscle = useMemo(
    () => (selectedId ? muscles.find(row => row.muscleGroupId === selectedId) ?? null : null),
    [muscles, selectedId]
  );

  const [sheetVisible, setSheetVisible] = useState(false);

  const selectWithAutoOrientation = (targetId: string) => {
    onSelect(targetId);
    const targetOrientation = canonicalOrientationForMuscle(targetId, report);
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
    const hit = hitWireframe({ point: [x, y], camera, selected: selectedMeshes, selectedId, report });
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
        onOverlayChange={handleOverlayChange}
        onPrev={handlePrevMuscle}
        orientation={orientation}
        overlay={overlay}
        selectedMuscle={selectedMuscle}
      />
      <View>
        <MuscleBodyViewportArea
          angleDeg={angleDeg}
          canvasFailed={canvasFailed}
          gesture={gesture}
          onAccessibilityAction={delta => {
            setDragOffsetDeg(0);
            setBaseAngleDeg(current => normaliseBodyAngle(current + delta));
          }}
          onCanvasError={() => setCanvasFailed(true)}
          onLayoutWidth={nextWidth => {
            if (nextWidth !== measuredWidth) setMeasuredWidth(nextWidth);
          }}
          onRetry={() => setCanvasFailed(false)}
          onSelectMuscle={selectWithAutoOrientation}
          orientation={orientation}
          projected={projected}
          viewportHeight={viewportHeight}
          viewportWidth={viewportWidth}
          wireframe={wireframe}
        />
        {!canvasFailed && selectedMeshes.length > 0 ? <View style={styles.viewerActions}>
          <FilterChip label={focus ? 'Whole body' : 'Focus'} on={focus} size="compact"
            accessibilityLabel={focus ? 'Show whole body' : 'Focus selected muscle'} accessibilityRole="button"
            onPress={() => setFocus(value => !value)} testID="stats-muscle-body-focus" />
        </View> : null}
        <View style={styles.information}>
          <Information title="About the muscle model" testIDPrefix="stats-muscle-body"
            body="Wireframe lines are triangle edges. Both views share the same coarse muscle surfaces. Muscle layers partially cover selected anatomy; several layers make it faint. Taps select the foreground body region. Shapes are visually fitted: Forearms use an outer group envelope with hand tendons; spinal erectors use smoothed columns; Abs and Lats use body-surface approximations."
            sections={[[ 'Anatomical source', 'BodyParts3D © The Database Center for Life Science, CC BY 4.0. Adapted by pose alignment, forearm/hand fitting, bilateral mirroring and simplified surface envelopes. Source and licence: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html' ]]} />
        </View>
      </View>
      {selectedMuscle ? (
        <MuscleBodyComparison
          metric={metric}
          selectedMuscle={selectedMuscle}
          viewportWidth={viewportWidth}
        />
      ) : null}
      <MuscleAccessibilityTargets
        activeInjuries={activeInjuries}
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

const styles = StyleSheet.create({
  viewerActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  information: { position: 'absolute', top: 0, right: 0 },
  comparisonLabels: { flexDirection: 'row', gap: uiSpace.sm },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  controlsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    flexShrink: 0,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    flexShrink: 1,
    minWidth: 0,
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
    flexShrink: 1,
    minWidth: 0,
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
  injuryBadgeAnchor: {
    position: 'absolute',
    zIndex: 10,
  },
});
