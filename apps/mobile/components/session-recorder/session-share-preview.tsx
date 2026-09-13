import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import {
  captureSessionShareImage,
  releaseSessionShareImage,
  shareSessionImage,
  type ExercisePersonalRecord,
  type ExerciseVolumeComparison,
  type SessionShareCaptureDimensions,
} from '@/src/session-insights';

import {
  ExerciseVolumeComparisonRow,
  formatExerciseVolume,
} from './exercise-volume-comparison';

type SessionShareSnapshot = {
  completedAt: string;
  durationDisplay: string;
  exerciseCount: number;
  performedSetCount: number;
  workingSetCount: number;
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
};

type CaptureSessionShareImage = (
  target: View,
  dimensions: SessionShareCaptureDimensions
) => Promise<string>;

type SessionSharePreviewProps = {
  visible: boolean;
  snapshot: SessionShareSnapshot;
  onClose: () => void;
  shouldFailNextShare?: boolean;
  captureImageAction?: CaptureSessionShareImage;
  shareImageAction?: (fileUri: string) => Promise<void>;
  releaseImageAction?: (fileUri: string) => void;
};

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

const formatSessionDate = (isoTimestamp: string): string => {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
};

const formatRecordFact = (record: ExercisePersonalRecord): string =>
  `${formatExerciseVolume(record.weight)} × ${record.reps} reps · est. 1RM ${formatExerciseVolume(
    Math.round(record.estimatedOneRepMax)
  )}`;

export function SessionShareCard({ snapshot }: { snapshot: SessionShareSnapshot }) {
  return (
    <View style={styles.shareCard} testID="session-share-card">
      <View style={styles.brandRow}>
        <UiText style={styles.brand} variant="title">
          BOGA
        </UiText>
        <UiText style={styles.brandTagline} variant="bodyMuted">
          Progress builds you
        </UiText>
      </View>
      <UiText style={styles.shareTitle} variant="title">
        Workout complete
      </UiText>
      <UiText variant="labelStrong">
        {`${snapshot.durationDisplay} · ${formatCount(snapshot.exerciseCount, 'exercise')} · ${formatCount(
          snapshot.performedSetCount,
          'set'
        )}`}
      </UiText>
      <UiText style={styles.shareMeta} variant="bodyMuted">
        {`${formatCount(snapshot.workingSetCount, 'working set')} · ${formatSessionDate(
          snapshot.completedAt
        )}`}
      </UiText>

      {snapshot.personalRecords.length > 0 ? (
        <UiSurface style={styles.shareRecords} testID="session-share-card-personal-records">
          <UiText style={styles.shareRecordsTitle} variant="labelStrong">
            {`${snapshot.personalRecords.length} personal ${
              snapshot.personalRecords.length === 1 ? 'record' : 'records'
            }`}
          </UiText>
          {snapshot.personalRecords.map((record) => (
            <View key={record.setId} style={styles.shareRecordRow} testID={`session-share-card-pr-${record.exerciseDefinitionId}`}>
              <View style={styles.shareRecordHeading}>
                <UiText style={styles.shareRecordLabel} variant="labelStrong">
                  New PR
                </UiText>
                <UiText numberOfLines={2} style={styles.shareRecordName} variant="labelStrong">
                  {record.exerciseName}
                </UiText>
              </View>
              <UiText style={styles.shareRecordFact} variant="subtitle">
                {formatRecordFact(record)}
              </UiText>
            </View>
          ))}
        </UiSurface>
      ) : null}

      <View style={styles.shareExerciseSection} testID="session-share-card-exercises">
        <UiText variant="title">Exercise volume</UiText>
        {snapshot.exerciseVolumeComparisons.map((comparison) => (
          <ExerciseVolumeComparisonRow
            key={`${comparison.exerciseDefinitionId ?? 'legacy'}-${comparison.sessionExerciseIds.join('-')}`}
            comparison={comparison}
            testID={`session-share-exercise-${comparison.sessionExerciseIds[0]}`}
            variant="share"
          />
        ))}
      </View>
      <UiText style={styles.madeWith} variant="bodyMuted">
        Made with BOGA
      </UiText>
    </View>
  );
}

export function SessionSharePreview({
  visible,
  snapshot,
  onClose,
  shouldFailNextShare = false,
  captureImageAction = captureSessionShareImage,
  shareImageAction = shareSessionImage,
  releaseImageAction = releaseSessionShareImage,
}: SessionSharePreviewProps) {
  const shareCardRef = useRef<View | null>(null);
  const hasFailedShareRef = useRef(false);
  const [cardDimensions, setCardDimensions] = useState<SessionShareCaptureDimensions | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleCardLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCardDimensions({ width, height });
  };

  const closePreview = () => {
    if (isSharing) return;
    setShareError(null);
    onClose();
  };

  const handleShareImage = () => {
    if (isSharing || !shareCardRef.current || !cardDimensions) return;
    const target = shareCardRef.current;
    const dimensions = cardDimensions;
    setShareError(null);
    setIsSharing(true);

    void (async () => {
      let fileUri: string | null = null;
      try {
        if (shouldFailNextShare && !hasFailedShareRef.current) {
          hasFailedShareRef.current = true;
          throw new Error('Share is temporarily unavailable. Try again.');
        }
        fileUri = await captureImageAction(target, dimensions);
        await shareImageAction(fileUri);
      } catch (error) {
        setShareError(
          error instanceof Error ? error.message : 'Unable to share the session image. Try again.'
        );
      } finally {
        if (fileUri) {
          try {
            releaseImageAction(fileUri);
          } catch {
            // A stale temporary file should not turn a completed share into an error.
          }
        }
        setIsSharing(false);
      }
    })();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={closePreview}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}>
      <View style={styles.modalRoot} testID="session-share-preview">
        <Pressable
          accessibilityLabel="Close session share preview"
          accessibilityRole="button"
          onPress={closePreview}
          style={styles.backdrop}
          testID="session-share-preview-backdrop"
        />
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />
          <View style={styles.sheetHeading}>
            <UiText variant="title">Share session</UiText>
            <Pressable
              accessibilityRole="button"
              disabled={isSharing}
              onPress={closePreview}
              style={styles.closeButton}
              testID="session-share-close">
              <UiText style={styles.closeButtonText} variant="labelStrong">
                Close
              </UiText>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.previewScrollContent}
            showsVerticalScrollIndicator
            testID="session-share-preview-scroll">
            <View
              collapsable={false}
              onLayout={handleCardLayout}
              ref={shareCardRef}
              style={styles.captureTarget}
              testID="session-share-capture-target">
              <SessionShareCard snapshot={snapshot} />
            </View>
          </ScrollView>
          <UiText style={styles.privacyText} variant="bodyMuted">
            Nothing is shared until you choose an app.
          </UiText>
          {shareError ? (
            <UiText
              accessibilityLiveRegion="polite"
              style={styles.shareError}
              testID="session-share-error">
              {shareError}
            </UiText>
          ) : null}
          <UiButton
            accessibilityHint="Creates the complete session image and opens the native share sheet."
            accessibilityLabel="Share session as image"
            disabled={isSharing || !cardDimensions}
            label={isSharing ? 'Preparing image…' : 'Share image'}
            testID="session-share-image"
            onPress={handleShareImage}
          />
          <UiButton
            accessibilityLabel="Cancel session sharing"
            disabled={isSharing}
            label="Cancel"
            testID="session-share-cancel"
            variant="secondary"
            onPress={closePreview}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  sheet: {
    maxHeight: '94%',
    paddingHorizontal: uiSpace.screen,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.screen,
    gap: uiSpace.sm,
    borderTopLeftRadius: uiRadius.xl,
    borderTopRightRadius: uiRadius.xl,
    backgroundColor: uiColors.surfaceDefault,
  },
  dragHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionNeutralSubtleBorder,
  },
  sheetHeading: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: uiColors.actionPrimary,
  },
  previewScrollContent: {
    paddingVertical: uiSpace.xs,
  },
  captureTarget: {
    width: '100%',
  },
  shareCard: {
    width: '100%',
    padding: uiSpace.xxl,
    gap: uiSpace.sm,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.lg,
    backgroundColor: uiColors.surfaceDefault,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  brand: {
    color: uiColors.actionPrimary,
    letterSpacing: 1,
  },
  brandTagline: {
    maxWidth: 92,
    textAlign: 'right',
    fontSize: uiTypography.size.xs,
  },
  shareTitle: {
    fontSize: uiTypography.size.xl,
  },
  shareMeta: {
    color: uiColors.actionPrimary,
  },
  shareRecords: {
    padding: uiSpace.md,
    gap: uiSpace.xs,
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  shareRecordsTitle: {
    color: uiColors.textSuccess,
  },
  shareRecordRow: {
    paddingTop: uiSpace.xs,
    gap: uiSpace.xxs,
    borderTopWidth: 1,
    borderTopColor: uiColors.borderSuccess,
  },
  shareRecordHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.xs,
  },
  shareRecordLabel: {
    color: uiColors.textSuccess,
  },
  shareRecordName: {
    flexShrink: 1,
  },
  shareRecordFact: {
    color: uiColors.textAccentStrong,
  },
  shareExerciseSection: {
    gap: uiSpace.sm,
  },
  madeWith: {
    textAlign: 'center',
    fontSize: uiTypography.size.xs,
    color: uiColors.textSecondary,
  },
  privacyText: {
    textAlign: 'center',
    fontSize: uiTypography.size.sm,
    color: uiColors.textSecondary,
  },
  shareError: {
    textAlign: 'center',
    color: uiColors.actionDangerText,
  },
});
