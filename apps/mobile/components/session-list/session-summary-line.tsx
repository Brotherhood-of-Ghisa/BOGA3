import { StyleSheet, Text, View } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextEmphasis, uiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatMonthDayTime } from '@/src/utils/local-time';

import { formatCompactDuration, type SessionListItem } from './types';

/** The session's local start stamp respecting preferences, from a stored ISO instant. */
export function formatDateTimeStamp(isoTimestamp: string, dateFormat: ExerciseDateFormat): string {
  return formatMonthDayTime(Date.parse(isoTimestamp), dateFormat);
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
  // What an active session's elapsed time is measured to; without it an
  // active session shows its stored duration.
  nowMs?: number;
  dateFormat?: ExerciseDateFormat;
};

export function SessionSummaryLine({
  session,
  testIdPrefix,
  nowMs,
  dateFormat,
}: SessionSummaryLineProps) {
  const [listPreferences] = useExerciseListPreferences();
  const resolvedDateFormat = dateFormat ?? listPreferences.dateFormat;
  const durationLabel =
    session.status === 'active' && nowMs !== undefined
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
          style={[uiText.figureSmall, uiTextTone.ink]}
          testID={`${testIdPrefix}-start`}>
          {formatDateTimeStamp(session.startedAt, resolvedDateFormat)}
        </Text>
        <Text allowFontScaling={false} selectable style={[uiText.meta, uiTextTone.faint]}>
          ·
        </Text>
        <Text
          allowFontScaling={false}
          selectable
          numberOfLines={1}
          style={[uiText.figureSmall, uiTextTone.ink]}
          testID={`${testIdPrefix}-duration`}>
          {durationLabel}
        </Text>
        {locationLabel ? (
          <>
            <Text allowFontScaling={false} selectable style={[uiText.meta, uiTextTone.faint]}>
              @
            </Text>
            <Text
              allowFontScaling={false}
              selectable
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[uiText.meta, uiTextTone.ink, uiTextEmphasis.strong, styles.summaryFlexibleToken]}
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
          style={uiText.meta}
          testID={`${testIdPrefix}-sets`}>
          <FigureText>{formatSetCount(session.setCount)}</FigureText>
        </Text>
        <Text allowFontScaling={false} selectable style={[uiText.meta, uiTextTone.faint]}>
          ·
        </Text>
        <Text
          allowFontScaling={false}
          selectable
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[uiText.meta, styles.summaryFlexibleToken]}
          testID={`${testIdPrefix}-exercises`}>
          <FigureText>{formatExerciseCount(session.exerciseCount)}</FigureText>
        </Text>
      </View>
    </View>
  );
}

// The start stamp and the duration are figures; the counts are words with
// their figures in Plex Mono, and the gym is words (`design-language.md` §3).
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
  summaryFlexibleToken: {
    flexShrink: 1,
    minWidth: 0,
  },
});
