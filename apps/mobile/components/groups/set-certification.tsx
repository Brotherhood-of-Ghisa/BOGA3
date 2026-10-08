import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Icon, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { GroupRole } from '@/src/groups';
import { sessionRecordCertificationStatus, type SessionRecordCertification } from '@/src/groups/competition-session-records-view-model';
import { buildMetricRecordSheetModel, metricCertificationEndConfirmation } from '@/src/groups/metric-record-sheet-view-model';
import { useMetricCertification } from '@/src/groups/use-metric-certification';

import { GroupWriteNotice } from './write-notice';

/**
 * A record set's one certification: its status and the one action open to me —
 * Certify, Withdraw (confirmed), or Refresh after a refused write. The lifter
 * sees the status only. testIDs: `<testID>-status`, `-certify`, `-withdraw`,
 * `-refresh`, `-notice`.
 */
export function GroupSetCertification({ certification, groupId, userId, myRole, online, onChanged, readOnlyReason, align = 'between', testID }: {
  certification: SessionRecordCertification; groupId: string; userId: string; myRole: GroupRole | null;
  online: boolean | null; onChanged: () => Promise<void>; readOnlyReason?: string;
  /** `between`: status left, action right (a row's own line). `end`: both at the end (beside the set). */
  align?: 'between' | 'end'; testID: string;
}) {
  const state = useMetricCertification({ groupId, userId, row: certification.target, exercise: certification.exercise,
    online, readOnlyReason, onChanged });
  const model = buildMetricRecordSheetModel({ ...state, row: certification.target, exercise: certification.exercise,
    userId, myRole, online, readOnlyReason });
  const guard = { blocked: model.blocked, active: model.active };
  const withdraw = () => {
    const { title, message, confirmLabel } = metricCertificationEndConfirmation('withdraw');
    Alert.alert(title, message, [{ text: 'Keep', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: () => void state.perform('withdraw', guard) }]);
  };
  const action = model.showRefresh ? { label: 'Refresh', onPress: state.refresh, disabled: state.pending || online === false }
    : model.canCertify ? { label: 'Certify', onPress: () => void state.perform('certify', guard), disabled: model.blocked }
    : model.canWithdraw ? { label: 'Withdraw', onPress: withdraw, disabled: model.blocked } : null;
  const status = sessionRecordCertificationStatus(model.active, userId);
  return (
    <View style={styles.block}>
      <View style={[styles.statusLine, align === 'end' ? styles.end : null]}>
        <View style={styles.status} accessible accessibilityLabel={status} testID={`${testID}-status`}>
          <Icon color={model.active ? uiRoles.ink : uiRoles.inkMuted} name={model.active ? 'check' : 'circle'} size="xs" />
          <Text allowFontScaling={false} style={[styles.statusText, model.active ? styles.statusCertified : null]}>{status}</Text>
        </View>
        {action ? (
          <ActionButton
            accessibilityLabel={`${action.label} set`}
            disabled={action.disabled}
            label={action.label}
            onPress={action.onPress}
            size="compact"
            testID={`${testID}-${action.label.toLowerCase()}`}
            variant="outline"
          />
        ) : null}
      </View>
      {state.notice?.tone === 'error' ? <GroupWriteNotice {...state.notice} testID={`${testID}-notice`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: uiSpace.xs },
  statusLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: uiSpace.sm },
  end: { justifyContent: 'flex-end' },
  status: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs, flexShrink: 1 },
  statusText: {
    fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted,
  },
  statusCertified: { color: uiRoles.ink },
});
