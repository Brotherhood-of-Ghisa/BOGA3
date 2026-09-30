import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import {
  captureSessionShareImage,
  releaseSessionShareImage,
  shareSessionImage,
  type ExercisePersonalRecord,
  type ExerciseVolumeComparison,
  type SessionShareCaptureDimensions,
} from '@/src/session-insights';
import { formatOneRepMaxFigure, formatWeightFigure } from '@/src/session-recorder/session-view-model';

import { ExerciseVolumeCard } from './exercise-volume-card';

export type SessionShareSnapshot = {
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

type SessionShareSheetProps = {
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

/**
 * The shared image: session totals, every PR and every exercise comparison, in
 * the design language. It never shows the gym or any location.
 */
export function SessionShareCard({ snapshot }: { snapshot: SessionShareSnapshot }) {
  return (
    <View style={styles.shareCard} testID="session-share-card">
      <View style={styles.brandRow}>
        <Text allowFontScaling={false} style={styles.brand}>BOGA</Text>
        <Text allowFontScaling={false} style={styles.tagline}>Progress builds you</Text>
      </View>
      <Text allowFontScaling={false} style={styles.shareTitle}>Workout complete</Text>
      <Text allowFontScaling={false} style={styles.totals}>
        {`${snapshot.durationDisplay} · ${formatCount(snapshot.exerciseCount, 'exercise')} · ${formatCount(
          snapshot.performedSetCount,
          'set'
        )}`}
      </Text>
      <Text allowFontScaling={false} style={styles.meta}>
        {`${formatCount(snapshot.workingSetCount, 'working set')} · ${formatSessionDate(snapshot.completedAt)}`}
      </Text>

      {snapshot.personalRecords.length > 0 ? (
        <View style={styles.records} testID="session-share-card-personal-records">
          <View style={styles.recordsHeading}>
            <Icon color={uiRoles.record} name="arrow-up" size="xs" />
            <Text allowFontScaling={false} style={styles.recordsTitle}>
              {`${snapshot.personalRecords.length} new 1RM ${
                snapshot.personalRecords.length === 1 ? 'record' : 'records'
              }`}
            </Text>
          </View>
          {snapshot.personalRecords.map((record) => (
            <View
              key={record.setId}
              style={styles.recordRow}
              testID={`session-share-card-pr-${record.exerciseDefinitionId}`}>
              <Text allowFontScaling={false} numberOfLines={2} style={styles.recordName}>
                {record.exerciseName}
              </Text>
              <Text allowFontScaling={false} style={styles.recordFact}>
                {`${formatWeightFigure(record.weight)} × ${record.reps}`}
                <Text allowFontScaling={false} style={styles.recordOneRepMax}>{`  1RM ${formatOneRepMaxFigure(
                  record.estimatedOneRepMax
                )}`}</Text>
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.exercises} testID="session-share-card-exercises">
        <Text allowFontScaling={false} style={styles.sectionTitle}>Exercise volume</Text>
        {snapshot.exerciseVolumeComparisons.map((comparison) => (
          <ExerciseVolumeCard
            key={`${comparison.exerciseDefinitionId ?? 'legacy'}-${comparison.sessionExerciseIds.join('-')}`}
            comparison={comparison}
            testID={`session-share-exercise-${comparison.sessionExerciseIds[0]}`}
            variant="share"
          />
        ))}
      </View>
      <Text allowFontScaling={false} style={styles.madeWith}>Made with BOGA</Text>
    </View>
  );
}

/**
 * `Share session`: a `Sheet` previewing the exact image, with `Share image` as
 * its one action. The backdrop, Android back and the VoiceOver escape close it,
 * except while an image is being prepared. Native-sheet cancel is silent; a
 * capture or launch failure shows inline and can be retried.
 */
export function SessionShareSheet({
  visible,
  snapshot,
  onClose,
  shouldFailNextShare = false,
  captureImageAction = captureSessionShareImage,
  shareImageAction = shareSessionImage,
  releaseImageAction = releaseSessionShareImage,
}: SessionShareSheetProps) {
  const { height } = useWindowDimensions();
  const shareCardRef = useRef<View | null>(null);
  const hasFailedShareRef = useRef(false);
  const [cardDimensions, setCardDimensions] = useState<SessionShareCaptureDimensions | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleCardLayout = (event: LayoutChangeEvent) => {
    const { width, height: cardHeight } = event.nativeEvent.layout;
    setCardDimensions({ width, height: cardHeight });
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
        setShareError(error instanceof Error ? error.message : 'Unable to share the session image. Try again.');
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
    <Sheet
      dismissLabel="Close session share preview"
      onDismiss={closePreview}
      testID="session-share-preview"
      title="Share session"
      visible={visible}>
      <ScrollView
        contentContainerStyle={styles.previewContent}
        style={{ maxHeight: height * 0.6 }}
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
      <View style={styles.footer}>
        <Text allowFontScaling={false} style={styles.privacy}>Nothing is shared until you choose an app.</Text>
        {shareError ? (
          <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={styles.error} testID="session-share-error">
            {shareError}
          </Text>
        ) : null}
        <ActionButton
          accessibilityHint="Creates the complete session image and opens the native share sheet."
          accessibilityLabel="Share session as image"
          disabled={isSharing || !cardDimensions}
          label={isSharing ? 'Preparing image…' : 'Share image'}
          onPress={handleShareImage}
          testID="session-share-image"
          variant="primary"
        />
      </View>
    </Sheet>
  );
}

const microLabel = {
  fontFamily: uiFonts.display.family,
  fontWeight: '700' as const,
  fontSize: uiTypography.size.xxs,
  lineHeight: uiTypography.lineHeight.xxs,
  letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  textTransform: 'uppercase' as const,
};

const styles = StyleSheet.create({
  previewContent: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
  captureTarget: {
    width: '100%',
  },
  footer: {
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.sm,
    gap: uiSpace.sm,
  },
  privacy: {
    textAlign: 'center',
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  error: {
    textAlign: 'center',
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.danger,
  },
  // The captured image: `paper` so it reads as the app does, cards on top.
  shareCard: {
    width: '100%',
    padding: uiSpace.lg,
    gap: uiSpace.sm,
    backgroundColor: uiRoles.paper,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.card,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  brand: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    letterSpacing: uiTypography.size.xl * uiGeometry.microLabelTracking,
    color: uiRoles.ink,
  },
  tagline: {
    ...microLabel,
    color: uiRoles.inkFaint,
  },
  shareTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  totals: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  meta: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  records: {
    backgroundColor: uiRoles.recordWash,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.recordRule,
    borderRadius: uiGeometry.radius.card,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  recordsHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  recordsTitle: {
    ...microLabel,
    color: uiRoles.record,
  },
  recordRow: {
    paddingTop: uiSpace.xs,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  recordName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  recordFact: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  recordOneRepMax: {
    fontWeight: '700',
    color: uiRoles.record,
  },
  exercises: {
    gap: uiSpace.sm,
  },
  sectionTitle: {
    ...microLabel,
    color: uiRoles.inkFaint,
  },
  madeWith: {
    ...microLabel,
    textAlign: 'center',
    color: uiRoles.inkFaint,
  },
});
