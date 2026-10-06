import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewInstance, type LayoutChangeEvent } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { PageSheet } from '@/components/ui/page-sheet';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import {
  captureSessionShareImage,
  releaseSessionShareImage,
  shareSessionImage,
  type ExercisePersonalRecord,
  type ExerciseVolumeComparison,
  type SessionShareCaptureDimensions,
} from '@/src/session-insights';

import { ExerciseVolumeCard } from './exercise-volume-card';

export type SessionShareSnapshot = {
  completedAt: string;
  durationDisplay: string;
  exerciseCount: number;
  // Working sets (`training-metrics-contract.md` "Counted set"): the image's one set count.
  workingSetCount: number;
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
};

type CaptureSessionShareImage = (
  target: ViewInstance,
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

/** One record line: the kind in words (the image has no screen reader), the figures it set in `record`. */
function ShareRecordRow({ record }: { record: ExercisePersonalRecord }) {
  const oneRepMax = record.estimatedOneRepMax === null ? '—' : formatOneRepMax(record.estimatedOneRepMax);
  return (
    <View style={styles.recordRow} testID={`session-share-card-pr-${record.exerciseDefinitionId}`}>
      <View style={styles.recordNameRow}>
        <Text allowFontScaling={false} numberOfLines={2} style={styles.recordName}>
          {record.exerciseName}
        </Text>
        <Text
          allowFontScaling={false}
          style={styles.recordKind}
          testID={`session-share-card-pr-${record.exerciseDefinitionId}-kind`}>
          {record.kind === 'oneRepMax' ? '1RM' : 'Top weight'}
        </Text>
      </View>
      <Text allowFontScaling={false} style={styles.recordFact}>
        <Text allowFontScaling={false} style={record.weightRecord ? styles.recordFigure : null}>
          {`${formatWeight(record.weight)} × ${record.reps}`}
        </Text>
        {'  1RM '}
        <Text allowFontScaling={false} style={record.kind === 'oneRepMax' ? styles.recordFigure : null}>
          {oneRepMax}
        </Text>
      </Text>
    </View>
  );
}

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
          snapshot.workingSetCount,
          'set'
        )}`}
      </Text>
      <Text allowFontScaling={false} style={styles.meta}>
        {formatSessionDate(snapshot.completedAt)}
      </Text>

      {snapshot.personalRecords.length > 0 ? (
        <View style={styles.records} testID="session-share-card-personal-records">
          <View style={styles.recordsHeading}>
            <Icon color={uiRoles.record} name="arrow-up" size="xs" />
            <Text allowFontScaling={false} style={styles.recordsTitle}>
              {formatCount(snapshot.personalRecords.length, 'new record')}
            </Text>
          </View>
          {snapshot.personalRecords.map((record) => (
            <ShareRecordRow key={record.setId} record={record} />
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
 * `Share session`: a `PageSheet` previewing the exact image, with `Share image`
 * as its one action. Swiping down, the X, Android back and the VoiceOver escape
 * close it, except while an image is being prepared. Native-sheet cancel is
 * silent; a capture or launch failure shows inline and can be retried.
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
  const shareCardRef = useRef<ViewInstance | null>(null);
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
    <PageSheet
      closeLabel="Close session share preview"
      dismissDisabled={isSharing}
      onDismiss={closePreview}
      testID="session-share-preview"
      title="Share session"
      visible={visible}>
      <ScrollView
        contentContainerStyle={styles.previewContent}
        style={styles.preview}
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
    </PageSheet>
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
  preview: {
    flex: 1,
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
  recordNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  recordKind: {
    ...microLabel,
    color: uiRoles.record,
  },
  recordName: {
    flexShrink: 1,
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
  recordFigure: {
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
