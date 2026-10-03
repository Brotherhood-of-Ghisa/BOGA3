import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import type { TodayProgressWeek } from '@/src/progress-summary';

import { formatWeekRange, weekFigureAccessibilityLabel, weekShare } from './progress-format';
import { todayText } from './text-styles';

type ShareBarProps = { current: number; previous: number; testID?: string };

// A thin bar on the `viz` ramp: `current` as a share of `previous`, full in the
// darker step once reached (`viz0` is the track).
export function ShareBar({ current, previous, testID }: ShareBarProps) {
  const { fraction, reached } = weekShare({ current, previous });
  return (
    <View style={styles.track} testID={testID}>
      <View
        style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }, reached ? styles.fillReached : null]}
        testID={testID ? `${testID}-fill` : undefined}
      />
    </View>
  );
}

type FigureProps = {
  label: string;
  current: number;
  previous: number;
  record?: boolean;
  testID: string;
};

function WeekFigure({ label, current, previous, record = false, testID }: FigureProps) {
  const showRecord = record && current > 0;
  return (
    <View
      accessible
      accessibilityLabel={weekFigureAccessibilityLabel(label, { current, previous })}
      style={styles.figure}
      testID={testID}>
      <Text allowFontScaling={false} style={todayText.microLabel}>
        {label}
      </Text>
      <View style={styles.valueRow}>
        {showRecord ? <Icon color={uiRoles.record} name="arrow-up" size="sm" /> : null}
        <Text
          allowFontScaling={false}
          style={[todayText.headlineFigure, showRecord ? todayText.record : null]}
          testID={`${testID}-value`}>
          {current}
        </Text>
      </View>
      <ShareBar current={current} previous={previous} testID={`${testID}-bar`} />
      <Text allowFontScaling={false} style={todayText.detailFigure} testID={`${testID}-previous`}>
        of {previous} last wk
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
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          This week
        </Text>
        <Text
          allowFontScaling={false}
          style={[todayText.microLabel, todayText.microLabelFaint]}
          testID="today-progress-week-range">
          {formatWeekRange(week.window)}
        </Text>
      </View>
      <View style={styles.figures}>
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

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  figures: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  figure: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
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
    backgroundColor: uiRoles.viz3,
  },
  fillReached: {
    backgroundColor: uiRoles.viz4,
  },
});
