import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionRecordLine } from '@/src/session-insights/record-line';

import { todayText } from './text-styles';

export type SessionSummaryRowMember = {
  name: string;
  /** The `set-current` ring and `Training now`, beside the name. */
  trainingNow: boolean;
};

export type SessionSummaryRowProps = {
  /** Whose session: the Group card names its member; the Progress card's own session has none. */
  member?: SessionSummaryRowMember | null;
  /** `10/16 06:10`, or `Started 07:40` for a session still in progress. */
  stamp: string;
  /** `1h 12m`; null while training. */
  duration: string | null;
  gym: string | null;
  /** `18 sets · 5 exercises`. */
  figures: string;
  record: SessionRecordLine | null;
  accessibilityLabel: string;
  accessibilityHint: string;
  onPress: () => void;
  testID: string;
};

/** The `set-current` ring before a training-now label. */
export function TrainingNowMark({ children }: { children: ReactNode }) {
  return (
    <View style={styles.liveMark}>
      <Icon name="set-current" size="xs" />
      {children}
    </View>
  );
}

function MemberHeader({ member, testID }: { member: SessionSummaryRowMember; testID: string }) {
  return (
    <View style={styles.header}>
      <Text
        allowFontScaling={false}
        ellipsizeMode="tail"
        numberOfLines={1}
        style={styles.member}
        testID={`${testID}-member`}>
        {member.name}
      </Text>
      {member.trainingNow ? (
        <View testID={`${testID}-training-now`}>
          <TrainingNowMark>
            <Text allowFontScaling={false} style={styles.liveText}>
              Training now
            </Text>
          </TrainingNowMark>
        </View>
      ) : null}
    </View>
  );
}

function RecordLine({ line, testID }: { line: SessionRecordLine; testID: string }) {
  return (
    <View style={styles.recordLine} testID={`${testID}-record`}>
      <Icon color={uiRoles.record} name="arrow-up" size="xs" />
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.recordText}>
        <Text allowFontScaling={false} style={todayText.record}>
          {line.kind === 'one' ? line.lead : line.count}
        </Text>
        {line.kind === 'one' ? <Text allowFontScaling={false} style={styles.muted}>{` · ${line.note}`}</Text> : null}
      </Text>
    </View>
  );
}

/**
 * One session as a link row, the same on both Today cards: the summary line
 * (stamp · duration @ gym), `sets · exercises`, then its PRs. The Group card
 * adds the member and the training-now mark above it. No group tags: the
 * server decides which groups a session was shared to (from membership
 * history), so the device cannot show them.
 */
export function SessionSummaryRow({
  member,
  stamp,
  duration,
  gym,
  figures,
  record,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  testID,
}: SessionSummaryRowProps) {
  const gymName = gym?.trim();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID={testID}>
      <View style={styles.copy}>
        {member ? <MemberHeader member={member} testID={testID} /> : null}
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.summaryLine}>
          <Text allowFontScaling={false} style={styles.summaryFigure} testID={`${testID}-start`}>
            {stamp}
          </Text>
          {duration ? (
            <>
              <Text allowFontScaling={false} style={styles.separator}> · </Text>
              <Text allowFontScaling={false} style={styles.summaryFigure}>{duration}</Text>
            </>
          ) : null}
          {gymName ? (
            <>
              <Text allowFontScaling={false} style={styles.separator}> @ </Text>
              <Text allowFontScaling={false} style={styles.gym}>{gymName}</Text>
            </>
          ) : null}
        </Text>
        <Text allowFontScaling={false} style={todayText.detailFigure} testID={`${testID}-figures`}>
          {figures}
        </Text>
        {record ? <RecordLine line={record} testID={testID} /> : null}
      </View>
      <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    minHeight: uiGeometry.tapTarget,
  },
  // A pressed row takes the `paper` ground, as `ListRow` does.
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  member: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  liveMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  liveText: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  summaryLine: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  summaryFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
  },
  separator: {
    color: uiRoles.inkFaint,
  },
  gym: {
    fontWeight: '600',
  },
  recordLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  recordText: {
    flexShrink: 1,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
  },
  muted: {
    color: uiRoles.inkMuted,
  },
});
