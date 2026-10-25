import { useDateFormat } from '@/src/preferences/hooks';
import { StyleSheet, Text, View } from 'react-native';

import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import type { TodayProgressWeek } from '@/src/progress-summary';

import { formatWeekRange, weekFigureAccessibilityLabel, weekShare } from './progress-format';
import { todayText } from './text-styles';

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

/** How a figure names the week it is compared with: short on screen, spelled out when spoken. */
export type PreviousWeekName = { short: string; spoken: string };

export const LAST_WEEK: PreviousWeekName = { short: 'last wk', spoken: 'last week' };

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
      <Text allowFontScaling={false} style={todayText.microLabel}>
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Text
          allowFontScaling={false}
          style={[todayText.headlineFigure, showRecord ? todayText.record : null]}
          testID={`${testID}-value`}>
          {current}
        </Text>
      </View>
      <ShareBar current={current} previous={previous} testID={`${testID}-bar`} />
      <Text allowFontScaling={false} style={todayText.detailFigure} testID={`${testID}-previous`}>
        vs {previous} {previousWeek.short}
      </Text>
    </View>
  );
}

// `This week` (Mon–Sun, local): sessions, working sets and PRs so far, each
// over last week's whole total. No signed deltas: a part week against a whole
// one says little.
export function WeekFigures({ week }: { week: TodayProgressWeek }) {
  const dateFormat = useDateFormat();
  return (
    <View style={styles.block} testID="today-progress-week">
      <View style={styles.heading}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          This week
        </Text>
        <Text
          allowFontScaling={false}
          style={[todayText.microLabel, todayText.microLabelFaint]}
          testID="today-progress-week-range">
          {formatWeekRange(week.window, dateFormat)}
        </Text>
      </View>
      <View style={weekFigureStyles.figures}>
        <WeekFigure
          current={week.current.sessions}
          label="Sessions"
          previous={week.previous.sessions}
          testID="today-progress-week-sessions"
        />
        <WeekFigure
          current={week.current.workingSets}
          label="Sets"
          previous={week.previous.workingSets}
          testID="today-progress-week-working-sets"
        />
        <WeekFigure
          current={week.current.prs}
          label="PRs"
          previous={week.previous.prs}
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
