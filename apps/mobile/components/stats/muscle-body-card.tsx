import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
  Card,
  FigureText,
  Icon,
  ListRow,
  SegmentedControl,
  Sheet,
  StatePanel,
  uiSpace,
  uiGeometry,
  uiBorder,
  useUiMode,
  useUiRoles,
  type SegmentedControlOption,
} from '@/components/ui';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { useNovemberAppearance } from '@/components/appearance/use-november-appearance';
import Svg, { Path } from 'react-native-svg';
import { InjuryBadge } from '@/components/injuries/injury-badge';
import type { ProgressMuscleComparison } from '@/src/data';
import type { InjuryView } from '@/src/data/injuries';
import { resolveInjuryMuscleGroupId } from '@/src/injuries/injury-warning-engine';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import { ComparisonHeaders, ComparisonValues, comparisonFigures, metricUnit, resolveComparisonLayout, type ComparisonLayout } from './comparison-columns';
import { StatsTableRow, StatsTableName } from './stats-table';
import {
  bodyOrientationForAngle,
  buildThemeShadePalette,
  canonicalOrientationForMuscle,
  computeMuscleScores,
  INJURY_STATUS_PRIORITY,
  normaliseBodyAngle,
  projectMuscleBody,
  resolveFocusedInjurySide,
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
  readonly overlay?: MuscleOverlayStyle;
  readonly activeInjuries?: readonly (ActiveInjuryOverlay | InjuryView)[];
  readonly comparisonLayout?: ComparisonLayout;
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
  readonly focus: boolean;
  readonly focusAvailable: boolean;
  readonly onFocusChange: (focus: boolean) => void;
  readonly selectedMuscle: ProgressMuscleComparison | null;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onOpenPicker: () => void;
};

function MuscleBodyHeader({ orientation, onOrientationChange, focus, focusAvailable, onFocusChange,
  selectedMuscle, onPrev, onNext, onOpenPicker }: HeaderProps) {
  const text = useUiText();
  const roles = useUiRoles();
  const swipe = Gesture.Pan().runOnJS(true)
    .activeOffsetX([-PAN_ACTIVATION_X, PAN_ACTIVATION_X])
    .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
    .onEnd((event, success) => {
      if (!success || Math.abs(event.translationX) < uiSpace.xl * 2 ||
        Math.abs(event.translationX) <= Math.abs(event.translationY)) return;
      if (event.translationX < 0) onNext();
      else onPrev();
    });
  return <>
    <View style={[styles.headerRow, { borderBottomWidth: uiBorder.width, borderBottomColor: roles.ruleSoft }]}>
      <GestureDetector gesture={swipe}>
        <Pressable
          accessibilityActions={[{ name: 'previous', label: 'Previous muscle' }, { name: 'next', label: 'Next muscle' }]}
          accessibilityHint="Opens muscle list. Swipe left for next muscle or right for previous muscle."
          accessibilityLabel={`Selected muscle: ${selectedMuscle?.displayName ?? 'None'}. Tap to choose another muscle.`}
          accessibilityRole="button"
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'next') onNext();
            if (event.nativeEvent.actionName === 'previous') onPrev();
          }}
          onPress={onOpenPicker}
          style={styles.pickerTrigger}
          testID="stats-muscle-body-picker-trigger">
          <Text allowFontScaling={false} style={[text.title, styles.muscleName]}
            testID="stats-muscle-body-selected">{selectedMuscle?.displayName ?? 'Select'}</Text>
          <Icon name="chevron-down" size="sm" />
        </Pressable>
      </GestureDetector>
    </View>
    <View style={styles.toolbar}>
      <SegmentedControl accessibilityLabel="Body orientation" density="compact" layout="inline"
        onChange={onOrientationChange} options={ORIENTATION_OPTIONS} selectedGround="selection"
        testIDPrefix="stats-muscle-body-angle" value={orientation} />
      <SegmentedControl accessibilityLabel="Body framing" density="compact" layout="inline"
        onChange={next => onFocusChange(next === 'focus')}
        options={[{ value: 'body', label: 'Whole body' }, { value: 'focus', label: 'Focus', disabled: !focusAvailable }]}
        selectedGround="selection" testIDPrefix="stats-muscle-body-framing" value={focus ? 'focus' : 'body'} />
    </View>
  </>;
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
      title="Select muscle"
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
              trailing={isSelected ? <Icon name="check" size="md" testID={`stats-muscle-picker-check-${row.muscleGroupId}`} /> : null}>
              <View style={styles.sheetRowContent}>
                <Text
                  allowFontScaling={false}
                  style={[text.bodyStrong, styles.sheetMuscleName, isSelected && tone.accent]}>
                  {row.displayName}
                </Text>
                <Text allowFontScaling={false} style={[text.body, styles.pickerValue]}
                  testID={`stats-muscle-picker-value-${row.muscleGroupId}`}>
                  <FigureText>{`${figures.now} ${metric === 'workingSetCount' ? 'sets' : unit}`}</FigureText>
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

function MuscleBodyComparison({ selectedMuscle, metric, layout }: {
  selectedMuscle: ProgressMuscleComparison; metric: ProgressMetric; layout: ComparisonLayout;
}) {
  const roles = useUiRoles();
  const values = <ComparisonValues compact row={selectedMuscle} metric={metric} layout={layout}
    prefix="stats-muscle-body-comparison" />;
  return <View style={[styles.comparison, { borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft }]} testID="stats-muscle-body-comparison">
    <ComparisonHeaders compact axis={false} layout={layout} metric={metric} name={null}
      testID="stats-muscle-body-comparison-header" />
    <StatsTableRow divider={false} meta={layout.stacked ? undefined : values}>
      <StatsTableName name={metric === 'workingSetCount' ? 'Sets' : 'Volume'} />
      {layout.stacked ? values : null}
    </StatsTableRow>
  </View>;
}

const toActiveInjuryOverlays = (
  activeInjuries?: readonly (ActiveInjuryOverlay | InjuryView)[]
): readonly ActiveInjuryOverlay[] | undefined => {
  if (!activeInjuries || activeInjuries.length === 0) return undefined;
  return activeInjuries.map(injury => ({
    id: injury.id,
    muscleGroupId: injury.muscleGroupId ?? null,
    side: injury.side ?? null,
    status: injury.status,
    painScore: injury.painScore ?? null,
    label: injury.label,
  }));
};

/**
 * Interactive 3D low-poly anatomical muscle model for the Progress Muscle breakdown.
 * Colours follow [[comparison.colour-scale]], with CIE LCh lighting,
 * supports horizontal drag-to-rotate across 360° plus Front/Back toggle,
 * and selects a reported muscle group on tap. Both views use opaque effort fills
 * and accent selection, attenuated through covering muscles. Wireframe adds
 * contrasting triangle edges over body and selected anatomy. Filled patches share the coarse anatomy,
 * camera, focus and hit testing; switching view changes only its material.
 * The separate muscle strip pages horizontally or opens the metric-aware picker.
 * The card controls orientation and framing. The footer shares its comparison layout
 * and content insets with the Exercises table.
 * Decoration follows [[appearance.november]] without changing hit testing.
 */
export function MuscleBodyCard({
  muscles,
  metric,
  selectedId,
  onSelect,
  report,
  setTargets,
  overlay = 'wireframe',
  activeInjuries,
  comparisonLayout,
}: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const november = useNovemberAppearance();
  const roles = useUiRoles();
  const mode = useUiMode();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [baseAngleDeg, setBaseAngleDeg] = useState(0);
  const [dragOffsetDeg, setDragOffsetDeg] = useState(0);
  const [failedOverlay, setFailedOverlay] = useState<MuscleOverlayStyle | null>(null);
  const canvasFailed = failedOverlay === overlay;
  if (failedOverlay !== null && !canvasFailed) setFailedOverlay(null);

  const [focus, setFocus] = useState(false);
  // Leave room for Progress controls, comparison and the tab bar on compact phones.
  const viewportHeight = Math.min(420, Math.max(VIEWPORT_HEIGHT, windowHeight - 440));
  const angleDeg = normaliseBodyAngle(baseAngleDeg + dragOffsetDeg);

  const viewportWidth =
    measuredWidth > 0
      ? measuredWidth
      : Math.max(MIN_VIEWPORT_WIDTH, windowWidth - CARD_HORIZONTAL_INSET);

  const activeInjuryOverlays = useMemo(() => toActiveInjuryOverlays(activeInjuries), [activeInjuries]);
  const focusedInjurySide = useMemo(
    () => resolveFocusedInjurySide(selectedId, activeInjuryOverlays, report),
    [selectedId, activeInjuryOverlays, report]
  );

  const orientation = bodyOrientationForAngle(angleDeg);
  const scores = useMemo(() => computeMuscleScores(muscles, metric, setTargets), [muscles, metric, setTargets]);
  const palette = useMemo(() => buildThemeShadePalette(roles, mode), [roles, mode]);
  const selectedMeshes = useMemo(
    () => selectMuscleMeshes(selectedId, report, focus, focusedInjurySide),
    [selectedId, report, focus, focusedInjurySide]
  );
  const camera = useMemo(() => wireframeCamera({ angle: angleDeg, width: viewportWidth, height: viewportHeight,
    selected: selectedMeshes, focus }), [angleDeg, viewportWidth, viewportHeight, selectedMeshes, focus]);
  const wireframe = useMemo(() => ({ overlay, camera, selected: selectedMeshes, scores, report, palette, roles, november }),
    [overlay, camera, selectedMeshes, scores, report, palette, roles, november]);

  const projected = useMemo(
    () =>
      projectMuscleBody({
        angleDeg,
        width: viewportWidth,
        height: viewportHeight,
        camera,
        scores,
        selectedId,
        report,
        palette,
        overlay,
        activeInjuries: activeInjuryOverlays,
      }),
    [angleDeg, viewportWidth, viewportHeight, camera, scores, selectedId, report, palette, overlay, activeInjuryOverlays]
  );

  const selectedMuscle = useMemo(
    () => (selectedId ? muscles.find(row => row.muscleGroupId === selectedId) ?? null : null),
    [muscles, selectedId]
  );

  const [sheetVisible, setSheetVisible] = useState(false);
  const layout = comparisonLayout ?? resolveComparisonLayout(windowWidth, selectedMuscle ? [selectedMuscle] : [],
    metric, false, { compact: true });

  const selectWithAutoOrientation = (targetId: string) => {
    onSelect(targetId);
    const targetOrientation = canonicalOrientationForMuscle(targetId, report);
    if (targetOrientation !== orientation) {
      setDragOffsetDeg(0);
      setBaseAngleDeg(targetOrientation === 'front' ? 0 : 180);
    }
  };

  const handleNextMuscle = () => {
    if (muscles.length < 2) return;
    const currentIndex = muscles.findIndex(row => row.muscleGroupId === selectedId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % muscles.length;
    selectWithAutoOrientation(muscles[nextIndex].muscleGroupId);
  };

  const handlePrevMuscle = () => {
    if (muscles.length < 2) return;
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
    <Card testID="stats-muscle-body-card">
      <View style={styles.viewer}>
        <MuscleBodyHeader
          onNext={handleNextMuscle}
          onOpenPicker={() => setSheetVisible(true)}
          onOrientationChange={next => {
            setDragOffsetDeg(0);
            setBaseAngleDeg(next === 'front' ? 0 : 180);
          }}
          focus={focus}
          focusAvailable={!canvasFailed && selectedMeshes.length > 0}
          onFocusChange={setFocus}
          onPrev={handlePrevMuscle}
          orientation={orientation}
          selectedMuscle={selectedMuscle}
        />
        <MuscleBodyViewportArea
          angleDeg={angleDeg}
          canvasFailed={canvasFailed}
          gesture={gesture}
          onAccessibilityAction={delta => {
            setDragOffsetDeg(0);
            setBaseAngleDeg(current => normaliseBodyAngle(current + delta));
          }}
          onCanvasError={() => setFailedOverlay(overlay)}
          onLayoutWidth={nextWidth => {
            if (nextWidth !== measuredWidth) setMeasuredWidth(nextWidth);
          }}
          onRetry={() => setFailedOverlay(null)}
          onSelectMuscle={selectWithAutoOrientation}
          orientation={orientation}
          projected={projected}
          viewportHeight={viewportHeight}
          viewportWidth={viewportWidth}
          wireframe={wireframe}
        />
      </View>
      {selectedMuscle ? (
        <MuscleBodyComparison
          metric={metric}
          selectedMuscle={selectedMuscle}
          layout={layout}
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
  viewer: { padding: uiSpace.md, gap: uiSpace.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm,
    paddingBottom: uiSpace.sm },
  comparison: { paddingTop: uiSpace.xs, paddingBottom: uiSpace.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: uiSpace.sm },
  pickerTrigger: {
    flex: 1, minWidth: 0, minHeight: uiGeometry.tapTarget,
    flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm,
  },
  muscleName: { flexShrink: 1, textTransform: 'capitalize' },
  sheetMuscleName: { flex: 1, minWidth: 0 },
  pickerValue: { flexShrink: 1, maxWidth: '50%', textAlign: 'right' },
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
    gap: uiSpace.md,
  },
  viewport: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: VIEWPORT_HEIGHT,
    overflow: 'hidden',
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
