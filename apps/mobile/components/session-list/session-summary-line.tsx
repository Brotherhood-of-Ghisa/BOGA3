import { StyleSheet, Text, View } from 'react-native';

import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

import { formatCompactDuration, type SessionListItem } from './types';

export function formatDateTimeStamp(isoTimestamp: string): string {
  const [datePart, timePartWithZone = '00:00:00'] = isoTimestamp.split('T');
  const [, month, day] = datePart.split('-');
  const timePart = timePartWithZone.slice(0, 5);

  return `${Number(month)}/${Number(day)} ${timePart}`;
}

export function formatSetCount(setCount: number): string {
  return `${setCount} sets`;
}

export function formatExerciseCount(exerciseCount: number): string {
  return `${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}`;
}

export function formatLocationLabel(gymName: string | null): string | null {
  const trimmedGymName = gymName?.trim();
  return trimmedGymName ? trimmedGymName : null;
}

export type SessionSummaryLineProps = {
  session: SessionListItem;
  testIdPrefix: string;
  nowMs?: number;
};

export function SessionSummaryLine({
  session,
  testIdPrefix,
  nowMs = Date.now(),
}: SessionSummaryLineProps) {
  const durationLabel =
    session.status === 'active'
      ? formatCompactDuration(
          Math.max(0, Math.floor((nowMs - new Date(session.startedAt).getTime()) / 1000))
        )
      : session.durationDisplay || formatCompactDuration(session.durationSec);
  const locationLabel = formatLocationLabel(session.gymName);

  return (
    <View style={styles.summaryLines}>
      <View style={styles.summaryRow}>
        <Text
          allowFontScaling={false}
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenPrimary, styles.summaryTokenStrong]}
          testID={`${testIdPrefix}-start`}>
          {formatDateTimeStamp(session.startedAt)}
        </Text>
        <Text allowFontScaling={false} selectable style={styles.summarySeparator}>
          ·
        </Text>
        <Text
          allowFontScaling={false}
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenStrong]}
          testID={`${testIdPrefix}-duration`}>
          {durationLabel}
        </Text>
        {locationLabel ? (
          <>
            <Text allowFontScaling={false} selectable style={[styles.summaryToken, styles.summaryAtToken, styles.summaryTokenStrong]}>
              @
            </Text>
            <Text
              allowFontScaling={false}
              selectable
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.summaryToken, styles.summaryLocationToken, styles.summaryTokenStrong]}
              testID={`${testIdPrefix}-gym`}>
              {locationLabel}
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.summaryRow}>
        <Text
          allowFontScaling={false}
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenSecondary]}
          testID={`${testIdPrefix}-sets`}>
          {formatSetCount(session.setCount)}
        </Text>
        <Text allowFontScaling={false} selectable style={styles.summarySeparator}>
          ·
        </Text>
        <Text
          allowFontScaling={false}
          selectable
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.summaryToken, styles.summaryTokenSecondary, styles.summaryFlexibleToken]}
          testID={`${testIdPrefix}-exercises`}>
          {formatExerciseCount(session.exerciseCount)}
        </Text>
      </View>
    </View>
  );
}

// Figures (the start stamp, the duration, the counts) are Plex Mono so they
// align down a list (`design-language.md` §3); the gym is words.
const styles = StyleSheet.create({
  summaryLines: {
    gap: uiSpace.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: uiSpace.xs,
    minWidth: 0,
  },
  summaryToken: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  summaryTokenPrimary: {
    color: uiRoles.ink,
  },
  summaryTokenStrong: {
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  summaryTokenSecondary: {
    color: uiRoles.inkMuted,
  },
  summaryAtToken: {
    fontFamily: uiFonts.body.family,
    color: uiRoles.inkFaint,
  },
  // A gym name is words, not a figure.
  summaryLocationToken: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
  },
  summaryFlexibleToken: {
    flexShrink: 1,
    minWidth: 0,
  },
  summarySeparator: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    color: uiRoles.inkFaint,
  },
});
