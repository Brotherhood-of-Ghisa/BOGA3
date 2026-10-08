import { useRouter, type Href } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Icon, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { GroupRole } from '@/src/groups';
import {
  sessionRecordCertificationStatus,
  type SessionRecordCertification,
  type SessionRecordRow,
} from '@/src/groups/competition-session-records-view-model';
import { buildMetricRecordSheetModel, metricCertificationEndConfirmation } from '@/src/groups/metric-record-sheet-view-model';
import { useMetricCertification } from '@/src/groups/use-metric-certification';

import { GroupWriteNotice } from './write-notice';

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
 * #1 on, its value as the record set it, and its certification now. A row
 * opens that board; a co-member certifies in one tap and the witness withdraws
 * (confirmed), both the same outline button. The lifter sees the status only.
 * Nothing renders without a row.
 */
export function GroupSessionRecordsCard({ rows, ...rest }: CardProps) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card} testID="group-session-records">
      <View style={styles.header}>
        <Text allowFontScaling={false} style={styles.headerLabel}>Group records</Text>
        <Text allowFontScaling={false} style={styles.headerCount} testID="group-session-records-count">{rows.length}</Text>
      </View>
      {rows.map(row => <RecordRow key={row.key} row={row} {...rest} />)}
    </View>
  );
}

// The link (title, value, detail, chevron) and the certification line are
// siblings: a button inside the link would hand a disabled tap to the link, and
// one accessible link would hide the status and the button from VoiceOver.
function RecordRow({ row, ...rest }: { row: SessionRecordRow } & Omit<CardProps, 'rows'>) {
  const router = useRouter();
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
            <Text allowFontScaling={false} numberOfLines={1} style={styles.title}>{row.title}</Text>
            <Text allowFontScaling={false} style={styles.value} testID={`${testID}-value`}>{row.value}</Text>
          </View>
          <Text allowFontScaling={false} style={styles.detail} testID={`${testID}-detail`}>{row.detail}</Text>
        </View>
        <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />
      </Pressable>
      {row.certification ? <RecordCertification certification={row.certification} testID={testID} {...rest} /> : null}
    </View>
  );
}

function RecordCertification({ certification, testID, groupId, userId, myRole, online, onChanged }: {
  certification: SessionRecordCertification; testID: string;
} & Omit<CardProps, 'rows'>) {
  const readOnlyReason = certification.eligible ? undefined : 'no longer a current entry';
  const state = useMetricCertification({ groupId, userId, row: certification.target, exercise: certification.exercise,
    online, readOnlyReason, onChanged });
  const model = buildMetricRecordSheetModel({ row: certification.target, exercise: certification.exercise, userId, myRole,
    certification: state.certification, readOnlyReason, online, pending: state.pending, needsReview: state.needsReview, notice: state.notice });
  const guard = { blocked: model.blocked, active: model.active };
  const withdraw = () => {
    const { title, message, confirmLabel } = metricCertificationEndConfirmation('withdraw');
    Alert.alert(title, message, [{ text: 'Keep', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: () => void state.perform('withdraw', guard) }]);
  };
  const action = model.canCertify ? { label: 'Certify', onPress: () => void state.perform('certify', guard) }
    : model.canWithdraw ? { label: 'Withdraw', onPress: withdraw } : null;

  return (
    <>
      <View style={styles.statusLine}>
        <View style={styles.status} accessible accessibilityLabel={sessionRecordCertificationStatus(model.active, userId)} testID={`${testID}-status`}>
          {model.active ? <Icon color={uiRoles.ink} name="check" size="xs" /> : <Icon color={uiRoles.inkMuted} name="circle" size="xs" />}
          <Text allowFontScaling={false} style={[styles.statusText, model.active ? styles.statusCertified : null]}>
            {sessionRecordCertificationStatus(model.active, userId)}
          </Text>
        </View>
        {action ? (
          <ActionButton
            accessibilityLabel={`${action.label} ${certification.target.metric === 'e1rm' ? '1RM' : 'Volume'}`}
            disabled={model.blocked}
            label={action.label}
            onPress={action.onPress}
            testID={`${testID}-${action.label.toLowerCase()}`}
            variant="outline"
          />
        ) : null}
      </View>
      {state.notice?.tone === 'error' ? <GroupWriteNotice {...state.notice} testID={`${testID}-notice`} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.recordRule,
    borderRadius: uiGeometry.radius.card,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: uiRoles.recordWash,
  },
  headerLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.record,
  },
  headerCount: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.record,
  },
  row: {
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  pressed: {
    backgroundColor: uiRoles.recordWash,
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
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.record,
  },
  detail: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
    // Under the link's text, clear of its chevron.
    paddingRight: uiSpace.lg + uiSpace.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    flexShrink: 1,
  },
  statusText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  statusCertified: {
    color: uiRoles.ink,
  },
});
