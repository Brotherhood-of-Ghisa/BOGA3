import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { Icon } from '@/components/ui/icon';
import { uiTextEmphasis, useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';
import type { SessionRecordLine } from '@/src/session-insights/record-line';

export type SessionSummaryRowProps = {
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
  /** Under the record line: Sessions' `Deleted` tag. */
  children?: ReactNode;
  /** The row's insets where its container gives none (a Sessions history row). */
  style?: StyleProp<ViewStyle>;
};

/** The `set-current` ring before a training-now label. */
export function TrainingNowMark({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.liveMark}>
      <Icon name="set-current" size="xs" />
      {children}
    </View>
  );
}

function RecordLine({ line, testID }: { line: SessionRecordLine; testID: string }) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <View style={styles.recordLine} testID={`${testID}-record`}>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[text.meta, styles.recordText]}>
        <Text allowFontScaling={false} style={tone.record}>
          {line.kind === 'one' ? line.lead : line.count}
        </Text>
        {line.kind === 'one' ? <Text allowFontScaling={false} style={tone.muted}>{` · ${line.note}`}</Text> : null}
      </Text>
    </View>
  );
}

/**
 * One session as a link row, a Sessions history row: the summary line
 * (stamp · duration @ gym), `sets · exercises`, then its PRs.
 */
export function SessionSummaryRow({
  stamp,
  duration,
  gym,
  figures,
  record,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  testID,
  children,
  style,
}: SessionSummaryRowProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const gymName = gym?.trim();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, style, pressed ? styles.pressed : null]}
      testID={testID}>
      <View style={styles.copy}>
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={text.body}>
          <Text allowFontScaling={false} style={text.inlineFigure} testID={`${testID}-start`}>
            {stamp}
          </Text>
          {duration ? (
            <>
              <Text allowFontScaling={false} style={tone.faint}> · </Text>
              <Text allowFontScaling={false} style={text.inlineFigure}>{duration}</Text>
            </>
          ) : null}
          {gymName ? (
            <>
              <Text allowFontScaling={false} style={tone.faint}> @ </Text>
              <Text allowFontScaling={false} style={uiTextEmphasis.strong}>{gymName}</Text>
            </>
          ) : null}
        </Text>
        <Text allowFontScaling={false} style={text.meta} testID={`${testID}-figures`}>
          <FigureText>{figures}</FigureText>
        </Text>
        {record ? <RecordLine line={record} testID={testID} /> : null}
        {children}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((roles) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    minHeight: uiGeometry.tapTarget,
  },
  // A pressed row takes the `paper` ground, as `ListRow` does.
  pressed: {
    backgroundColor: roles.paper,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  liveMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  recordLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordText: {
    flexShrink: 1,
  },
}));
