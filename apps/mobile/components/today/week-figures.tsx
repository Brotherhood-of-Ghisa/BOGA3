import { useDateFormat } from '@/src/preferences/hooks';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { FigureText } from '@/components/ui/figure-text';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import type { UiRoles } from '@/components/ui/theme';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiGeometry, uiIconSize, uiSpace } from '@/components/ui/tokens';
import type { TodayProgressWeek } from '@/src/progress-summary';
import type { ProgressMetric } from '@/src/preferences/model';

import { formatPaceValue, formatPeriodRange, formatWeekRange, weekFigureAccessibilityLabel, weekShare } from './progress-format';

type ShareBarProps = { current: number | null; previous: number | null; testID?: string };

// One `viz` step per lap of `previous` (`weekShare`): `viz2` up to it, `viz3`
// up to twice it, `viz4` beyond. A lap fills over the one before, full; the
// first over the `viz0` track.
const lapFills = (roles: UiRoles) => [roles.viz2, roles.viz3, roles.viz4] as const;

// A thin bar on the `viz` ramp: `current` as a share of `previous`, in laps.
export function ShareBar({ current, previous, testID }: ShareBarProps) {
  const styles = useStyles();
  const roles = useUiRoles();
  if (current === null || previous === null) return <View style={styles.track} testID={testID} />;
  const { lap, fraction } = weekShare({ current, previous });
  const fills = lapFills(roles);
  return (
    <View
      style={[styles.track, lap > 0 ? { backgroundColor: fills[lap - 1] } : null]}
      testID={testID}>
      <View
        style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: fills[lap] }]}
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
  current: number | null;
  previous: number | null;
  metric?: ProgressMetric;
  onToggleMetric?: () => void;
  record?: boolean;
  previousWeek?: PreviousWeekName;
  testID: string;
};

export function WeekFigure({ label, current, previous, record = false, previousWeek = LAST_WEEK, testID,
  metric = 'workingSetCount', onToggleMetric }: FigureProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const showRecord = record && current !== null && current > 0;
  const currentText = formatPaceValue(current, metric);
  const previousText = formatPaceValue(previous, metric);
  const spoken = metric === 'totalVolume'
    ? `Tonnes ${current === null ? 'unavailable' : currentText}, vs ${previous === null ? 'unavailable' : previousText} ${previousWeek.spoken}`
    : weekFigureAccessibilityLabel(label, { current: current ?? 0, previous: previous ?? 0 }, previousWeek.spoken);
  const content = (
    <View
      accessible={!onToggleMetric}
      accessibilityLabel={spoken}
      style={styles.figure}
      testID={testID}>
      <View style={styles.metricLabel}>
        <Text allowFontScaling={false} style={text.label}>{label}</Text>
        {onToggleMetric ? <Icon colorRole="inkMuted" name="swap" size="sm" /> : null}
      </View>
      <View style={styles.valueRow}>
        <Text
          allowFontScaling={false}
          style={[text.figureHero, showRecord ? tone.record : null]}
          testID={`${testID}-value`}>
          {currentText}
        </Text>
      </View>
      <ShareBar current={current} previous={previous} testID={`${testID}-bar`} />
      <Text allowFontScaling={false} style={text.meta} testID={`${testID}-previous`}>
        <FigureText>{previousWeek.short ? `vs ${previousText} ${previousWeek.short}` : `vs ${previousText}`}</FigureText>
      </Text>
    </View>
  );
  return onToggleMetric ? (
    <Pressable accessibilityLabel={`${spoken}. ${metric === 'totalVolume' ? 'Switch to sets' : 'Switch to tonnes'}`}
      accessibilityRole="button" onPress={onToggleMetric} style={styles.figure} testID={`${testID}-metric-toggle`}>
      {content}
    </Pressable>
  ) : content;
}

// `This week` (Mon–Sun, local): sessions, sets or tonnes and PRs so far, each
// over last week's whole total. No signed deltas: a part week against a whole
// one says little.
export function WeekFigures({ week, metric, onToggleMetric }: { week: TodayProgressWeek; metric: ProgressMetric; onToggleMetric: () => void }) {
  const dateFormat = useDateFormat();
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <View style={styles.block} testID="today-progress-week">
      <View style={styles.heading}>
        <Text allowFontScaling={false} style={[text.label, tone.ink]}>
          This week
        </Text>
        <Text
          allowFontScaling={false}
          style={[text.label, tone.faint]}
          accessibilityLabel={formatWeekRange(week.window, dateFormat)}
          testID="today-progress-week-range">
          {formatPeriodRange(week.window, dateFormat)}
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
          current={metric === 'totalVolume' ? week.current.volumeKgReps : week.current.workingSets}
          label={metric === 'totalVolume' ? 'Tons' : 'Sets'}
          metric={metric}
          onToggleMetric={onToggleMetric}
          previous={metric === 'totalVolume' ? week.previous.volumeKgReps : week.previous.workingSets}
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

const useStyles = makeStyles((roles) => ({
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
  metricLabel: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs, minHeight: uiIconSize.sm },
  // One child since the record mark went; `row` still sizes the figure to its
  // content rather than stretching it.
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: roles.viz0,
    marginTop: uiSpace.xs,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
  },
}));
