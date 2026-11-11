import { useRouter, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { FigureText, makeStyles, uiBorder, uiGeometry, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import type { GroupRole } from '@/src/groups';
import type { SessionRecordRow } from '@/src/groups/competition-session-records-view-model';

import { scoreHasFigure, useScoreStyle } from './score-style';
import { GroupSetCertification } from './set-certification';

type CardProps = {
  rows: SessionRecordRow[];
  groupId: string;
  userId: string;
  myRole: GroupRole | null;
  online: boolean | null;
  onChanged: () => Promise<void>;
};

/**
 * The group session view's Group records: one row per board the session took
 * #1 on, its value as the record set it, and its certification now. A row's
 * text opens that board; a co-member certifies in one tap and the witness withdraws
 * (confirmed), both the same compact outline button. The lifter sees the status only.
 * Nothing renders without a row.
 */
export function GroupSessionRecordsCard({ rows, ...rest }: CardProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} testID="group-session-records">
      <View style={styles.header}>
        <Text allowFontScaling={false} style={[text.label, tone.record]}>Group records</Text>
        <Text allowFontScaling={false} style={[text.figureSmall, tone.record]} testID="group-session-records-count">{rows.length}</Text>
      </View>
      {rows.map(row => <RecordRow key={row.key} row={row} {...rest} />)}
    </View>
  );
}

// The link (title, value, detail) and the certification line are
// siblings: a button inside the link would hand a disabled tap to the link, and
// one accessible link would hide the status and the button from VoiceOver.
function RecordRow({ row, ...rest }: { row: SessionRecordRow } & Omit<CardProps, 'rows'>) {
  const router = useRouter();
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const scoreStyle = useScoreStyle();
  const testID = `group-session-record-${row.key}`;
  return (
    <View style={styles.row} testID={testID}>
      <Pressable
        accessibilityHint="Opens the leaderboard"
        accessibilityLabel={`${row.title}, ${row.value}, ${row.detail}`}
        accessibilityRole="link"
        onPress={() => router.push(row.boardHref as Href)}
        style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}
        testID={`${testID}-link`}>
        <View style={styles.rowBody}>
          <View style={styles.titleLine}>
            <Text allowFontScaling={false} numberOfLines={1} style={[text.bodyStrong, styles.title]}>{row.title}</Text>
            <Text allowFontScaling={false} style={[scoreStyle(row.value, 'base'), scoreHasFigure(row.value) ? tone.record : null]} testID={`${testID}-value`}><FigureText figureStyle={[scoreStyle(row.value, 'base'), scoreHasFigure(row.value) ? tone.record : null]}>{row.value}</FigureText></Text>
          </View>
          <Text allowFontScaling={false} style={text.meta} testID={`${testID}-detail`}><FigureText>{row.detail}</FigureText></Text>
        </View>
      </Pressable>
      {row.certification ? <GroupSetCertification certification={row.certification} testID={testID}
        readOnlyReason={row.certification.eligible ? undefined : 'no longer a current entry'} {...rest} /> : null}
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  card: {
    backgroundColor: roles.surface,
    borderWidth: uiBorder.width,
    borderColor: roles.recordRule,
    borderRadius: uiGeometry.radius.card,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: roles.recordWash,
  },
  row: {
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: roles.recordRule,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  pressed: {
    backgroundColor: roles.recordWash,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
}));
