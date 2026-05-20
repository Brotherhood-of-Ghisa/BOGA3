import { StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';

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
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenPrimary, styles.summaryTokenStrong]}
          testID={`${testIdPrefix}-start`}>
          {formatDateTimeStamp(session.startedAt)}
        </Text>
        <Text selectable style={styles.summarySeparator}>
          •
        </Text>
        <Text
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenStrong]}
          testID={`${testIdPrefix}-duration`}>
          {durationLabel}
        </Text>
        {locationLabel ? (
          <>
            <Text selectable style={[styles.summaryToken, styles.summaryAtToken, styles.summaryTokenStrong]}>
              @
            </Text>
            <Text
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
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenSecondary]}
          testID={`${testIdPrefix}-sets`}>
          {formatSetCount(session.setCount)}
        </Text>
        <Text selectable style={styles.summarySeparator}>
          •
        </Text>
        <Text
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

const styles = StyleSheet.create({
  summaryLines: {
    gap: 2,
    minHeight: 34,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 4,
    minWidth: 0,
  },
  summaryToken: {
    color: uiColors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  summaryTokenPrimary: {
    color: uiColors.textAccentStrong,
  },
  summaryTokenStrong: {
    fontSize: 13,
    fontWeight: '700',
  },
  summaryTokenSecondary: {
    color: uiColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryAtToken: {
    color: uiColors.textSecondary,
  },
  summaryLocationToken: {
    flexShrink: 1,
    minWidth: 0,
  },
  summaryFlexibleToken: {
    flexShrink: 1,
    minWidth: 0,
  },
  summarySeparator: {
    color: uiColors.textDisabled,
    fontSize: 11,
  },
});
