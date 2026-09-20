import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  UiButton,
  UiSurface,
  UiText,
  uiBorder,
  uiColors,
  uiRadius,
  uiSpace,
} from '@/components/ui';
import type { CurrentSessionMuscleSummary } from '@/src/session-insights';

export type SessionMuscleLoadCatalogState = 'loading' | 'ready' | 'error';

type SessionMuscleLoadProps = {
  visible: boolean;
  catalogState: SessionMuscleLoadCatalogState;
  performedSetCount: number;
  workingSetCount: number;
  summary: CurrentSessionMuscleSummary | null;
  onRetry: () => void;
};

const formatSetCount = (count: number): string => `${count} ${count === 1 ? 'set' : 'sets'}`;

const formatWeightedVolume = (value: number): string =>
  new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 2,
  }).format(value);

const buildCountLabel = (performedSetCount: number, workingSetCount: number): string =>
  `${formatSetCount(performedSetCount)} (${workingSetCount} working)`;

export function SessionMuscleLoad({
  visible,
  catalogState,
  performedSetCount,
  workingSetCount,
  summary,
  onRetry,
}: SessionMuscleLoadProps) {
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const shouldRender =
    visible && performedSetCount > 0 && !(catalogState === 'ready' && summary?.state === 'empty');

  useEffect(() => {
    if (!shouldRender) {
      setIsSheetVisible(false);
    }
  }, [shouldRender]);

  if (!shouldRender) {
    return null;
  }

  const isMapped = catalogState === 'ready' && summary?.state === 'mapped';
  const isUnmapped = catalogState === 'ready' && summary?.state === 'unmapped';
  const countLabel = buildCountLabel(performedSetCount, workingSetCount);
  const leadingMuscles = summary?.muscles
    .slice(0, 3)
    .map((muscle) => muscle.displayName)
    .join(' · ');
  const rowStatus =
    catalogState === 'loading'
      ? `Loading mappings · ${countLabel}`
      : catalogState === 'error'
        ? `Unavailable · ${countLabel}`
        : isUnmapped
          ? `No mapped muscle load · ${countLabel}`
          : `${summary?.contributingMuscleCount ?? 0} ${
              summary?.contributingMuscleCount === 1 ? 'muscle' : 'muscles'
            } · ${countLabel}`;

  return (
    <>
      <UiSurface style={styles.summarySurface} testID="session-muscle-load-surface">
        <Pressable
          accessibilityHint="Opens muscle load details for the current session."
          accessibilityLabel={`Session muscle load. ${rowStatus}${leadingMuscles ? `. ${leadingMuscles}` : ''}`}
          accessibilityRole="button"
          style={styles.summaryPressable}
          testID="session-muscle-load-row"
          onPress={() => setIsSheetVisible(true)}>
          <View style={styles.summaryCopy}>
            <UiText variant="labelStrong">Session muscle load</UiText>
            <UiText variant="bodyMuted" testID="session-muscle-load-row-status">
              {rowStatus}
            </UiText>
            {isMapped && leadingMuscles ? (
              <UiText numberOfLines={1} variant="subtitle">
                {leadingMuscles}
              </UiText>
            ) : null}
          </View>
          <UiText accessibilityElementsHidden importantForAccessibility="no-hide-descendants" variant="title">
            ›
          </UiText>
        </Pressable>
        {catalogState === 'error' ? (
          <UiButton
            accessibilityLabel="Retry session muscle load"
            label="Retry"
            style={styles.compactRetryButton}
            variant="secondary"
            onPress={onRetry}
          />
        ) : null}
      </UiSurface>

      <Modal
        animationType="slide"
        transparent
        visible={shouldRender && isSheetVisible}
        onRequestClose={() => setIsSheetVisible(false)}>
        <View style={styles.sheetContainer} testID="session-muscle-load-sheet">
          <Pressable
            accessibilityLabel="Dismiss session muscle load"
            style={styles.sheetBackdrop}
            onPress={() => setIsSheetVisible(false)}
          />
          <UiSurface accessibilityViewIsModal style={styles.sheetSurface}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <UiText variant="title">Session muscle load</UiText>
                <UiText variant="bodyMuted">{countLabel}</UiText>
              </View>
              <UiButton
                accessibilityLabel="Close session muscle load"
                label="Close"
                style={styles.closeButton}
                variant="secondary"
                onPress={() => setIsSheetVisible(false)}
              />
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}>
              {catalogState === 'loading' ? (
                <UiText variant="bodyMuted">Loading muscle mappings…</UiText>
              ) : null}

              {catalogState === 'error' ? (
                <UiSurface style={styles.statePanel} variant="panelMuted">
                  <UiText variant="labelStrong">Muscle load unavailable</UiText>
                  <UiText variant="bodyMuted">
                    The exercise catalog or muscle mappings could not be loaded. Workout logging,
                    autosave, and submission are unaffected.
                  </UiText>
                  <UiButton
                    accessibilityLabel="Retry session muscle load from details"
                    label="Retry"
                    variant="secondary"
                    onPress={onRetry}
                  />
                </UiSurface>
              ) : null}

              {isUnmapped ? (
                <UiSurface style={styles.statePanel} variant="panelMuted">
                  <UiText variant="labelStrong">No mapped muscle load</UiText>
                  <UiText variant="bodyMuted">
                    The performed exercises do not currently contribute to muscle analytics.
                  </UiText>
                </UiSurface>
              ) : null}

              {isMapped
                ? summary?.muscles.map((muscle) => {
                    const weightedVolumeLabel = formatWeightedVolume(muscle.weightedVolume);
                    const relativePercent = Math.round(muscle.relativeVolume * 100);
                    return (
                      <View
                        accessibilityLabel={`${muscle.displayName}: ${weightedVolumeLabel} weighted kg reps; ${relativePercent} percent of this session's maximum.`}
                        accessible
                        key={muscle.id}
                        style={styles.muscleRow}
                        testID={`session-muscle-load-muscle-${muscle.id}`}>
                        <View style={styles.muscleLabelRow}>
                          <UiText style={styles.muscleName} variant="label">
                            {muscle.displayName}
                          </UiText>
                          <UiText variant="subtitle">{weightedVolumeLabel} weighted kg·reps</UiText>
                        </View>
                        <View
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${relativePercent}%` }]} />
                        </View>
                      </View>
                    );
                  })
                : null}

              {isMapped && (summary?.unmappedSetCount ?? 0) > 0 ? (
                <UiText testID="session-muscle-load-partial-note" variant="bodyMuted">
                  {`${summary?.unmappedSetCount} ${
                    summary?.unmappedSetCount === 1 ? 'performed set has' : 'performed sets have'
                  } no eligible muscle mapping.`}
                </UiText>
              ) : null}

              {isMapped ? (
                <UiText variant="bodyMuted">
                  Bars compare muscle load only within this session. They do not indicate recovery,
                  readiness, or targets.
                </UiText>
              ) : null}
            </ScrollView>
          </UiSurface>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  summarySurface: {
    overflow: 'hidden',
  },
  summaryPressable: {
    minHeight: 64,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  compactRetryButton: {
    alignSelf: 'flex-start',
    marginBottom: uiSpace.md,
    marginHorizontal: uiSpace.md,
    minWidth: 88,
  },
  sheetContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  sheetSurface: {
    maxHeight: '82%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: uiSpace.xl,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    marginBottom: uiSpace.sm,
    marginTop: uiSpace.sm,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.borderStrong,
  },
  sheetHeader: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiColors.borderMuted,
  },
  sheetHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  closeButton: {
    minWidth: 76,
  },
  sheetContent: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  statePanel: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  muscleRow: {
    gap: uiSpace.sm,
  },
  muscleLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.md,
  },
  muscleName: {
    flex: 1,
  },
  barTrack: {
    height: 10,
    overflow: 'hidden',
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.heatmapNeutralBg,
  },
  barFill: {
    height: '100%',
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionPrimary,
  },
});
