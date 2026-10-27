import { StyleSheet, Text, View } from 'react-native';

import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import type { TodayProgressWeek } from '@/src/progress-summary';

import { formatPeriodRange, weekFigureAccessibilityLabel, weekShare } from './progress-format';

type ShareBarProps = { current: number; previous: number; testID?: string };

// One `viz` step per lap of `previous` (`weekShare`): `viz2` up to it, `viz3`
// up to twice it, `viz4` beyond. A lap fills over the one before, full; the
// first over the `viz0` track.
const LAP_FILLS = [uiRoles.viz2, uiRoles.viz3, uiRoles.viz4] as const;

// A thin bar on the `viz` ramp: `current` as a share of `previous`, in laps.
export function ShareBar({ current, previous, testID }: ShareBarProps) {
  const { lap, fraction } = weekShare({ current, previous });
  return (
    <View
      style={[styles.track, lap > 0 ? { backgroundColor: LAP_FILLS[lap - 1] } : null]}
      testID={testID}>
      <View
        style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: LAP_FILLS[lap] }]}
        testID={testID ? `${testID}-fill` : undefined}
      />
    </View>
  );
}

/** How a figure names the week it is compared with: short on screen (none on Today), spelled out when spoken. */
export type PreviousWeekName = { short: string | null; spoken: string };

export const LAST_WEEK: PreviousWeekName = { short: 'last wk', spoken: 'last week' };
// Today's heading already names the week, so its figures read `vs 4`.
const TODAY_LAST_WEEK: PreviousWeekName = { short: null, spoken: 'last week' };

type FigureProps = {
  label: string;
  current: number;
  previous: number;
  record?: boolean;
  previousWeek?: PreviousWeekName;
  testID: string;
};

export function WeekFigure({ label, current, previous, record = false, previousWeek = LAST_WEEK, testID }: FigureProps) {
  const showRecord = record && current > 0;
  return (
    <View
      accessible
      accessibilityLabel={weekFigureAccessibilityLabel(label, { current, previous }, previousWeek.spoken)}
      style={styles.figure}
      testID={testID}>
      <Text allowFontScaling={false} style={uiText.label}>
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Text
          allowFontScaling={false}
          style={[uiText.figureHero, showRecord ? uiTextTone.record : null]}
          testID={`${testID}-value`}>
          {current}
        </Text>
      </View>
      <ShareBar current={current} previous={previous} testID={`${testID}-bar`} />
      <Text allowFontScaling={false} style={uiText.figureSmall} testID={`${testID}-previous`}>
        {previousWeek.short ? `vs ${previous} ${previousWeek.short}` : `vs ${previous}`}
      </Text>
    </View>
  );
}

// `This week` (Mon–Sun, local): sessions, working sets and PRs so far, each
// over last week's whole total. No signed deltas: a part week against a whole
// one says little.
export function WeekFigures({ week }: { week: TodayProgressWeek }) {
  return (
    <View style={styles.block} testID="today-progress-week">
      <View style={styles.heading}>
        <Text allowFontScaling={false} style={[uiText.label, uiTextTone.ink]}>
          This week
        </Text>
        <Text
          allowFontScaling={false}
          style={[uiText.label, uiTextTone.faint]}
          testID="today-progress-week-range">
          {formatPeriodRange(week.window)}
        </Text>
      </View>
      <View style={weekFigureStyles.figures}>
        <WeekFigure
          current={week.current.sessions}
          label="Sessions"
          previous={week.previous.sessions}
          previousWeek={TODAY_LAST_WEEK}
          testID="today-progress-week-sessions"
        />
        <WeekFigure
          current={week.current.workingSets}
          label="Sets"
          previous={week.previous.workingSets}
          previousWeek={TODAY_LAST_WEEK}
          testID="today-progress-week-working-sets"
        />
        <WeekFigure
          current={week.current.prs}
          label="PRs"
          previous={week.previous.prs}
          previousWeek={TODAY_LAST_WEEK}
          record
          testID="today-progress-week-prs"
        />
      </View>
    </View>
  );
}

const BAR_HEIGHT = 6;

export const weekFigureStyles = StyleSheet.create({
  figures: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
});

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  figure: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  // One child since the record mark went; `row` still sizes the figure to its
  // content rather than stretching it.
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.viz0,
    marginTop: uiSpace.xs,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
  },
});
