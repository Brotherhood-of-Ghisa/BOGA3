import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiButton, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import {
  DESTRUCTIVE_RECORD_SET_ACTIONS,
  RECORD_SET_ACTION_LABELS,
  applyWrittenCertification,
  buildRecordSetSheet,
  getGroupSessionDetail,
  groupCacheKeys,
  recordSetActionConfirmation,
  recordSetKey,
  useGroupResource,
  type GroupRole,
  type GroupSessionDetailResult,
  type RecordSetAction,
  type RecordSetCertificationState,
  type RecordSetDetail,
} from '@/src/groups';

import { GroupWriteNotice } from './write-notice';

type RecordSetSheetProps = {
  /** The set the sheet shows; null hides it. */
  detail: RecordSetDetail | null;
  userId: string;
  /** My role in the set's group; null when unknown (Cancel is then hidden). */
  myRole: GroupRole | null;
  /** The host's certification writes (`useRecordSetCertification`), shared with inline Certify buttons. */
  certification: RecordSetCertificationState;
  onClose: () => void;
};

/**
 * The record set row detail (product E2), shared by board rows and stream
 * record cards: values, the as-logged value when converted, date and gym,
 * "Logged as", the certification line, and the certification actions my
 * relationship to the set allows (08 pattern 11). Every write is online-only;
 * removals confirm first.
 */
export function RecordSetSheet({ detail, userId, myRole, certification, onClose }: RecordSetSheetProps) {
  const router = useRouter();
  const memberId = detail?.member.user_id ?? null;
  const sessionId = detail?.sessionId ?? null;
  const fetcher = useCallback(
    () => getGroupSessionDetail(memberId ?? '', sessionId ?? ''),
    [memberId, sessionId],
  );
  // Gym and "Logged as" come from the session detail, cache-first and shared with the friend view.
  const session = useGroupResource<GroupSessionDetailResult>({
    userId,
    cacheKey: memberId && sessionId ? groupCacheKeys.session(memberId, sessionId) : null,
    fetcher,
  });

  const shown = useMemo(
    () => (detail ? applyWrittenCertification(detail, certification.written) : null),
    [detail, certification.written],
  );
  const model = useMemo(
    () =>
      shown
        ? buildRecordSetSheet(shown, {
            myUserId: userId,
            myRole,
            session: session.data?.session ?? null,
            sessionMissing: session.lostAccess,
          })
        : null,
    [shown, userId, myRole, session.data, session.lostAccess],
  );

  const setKey = shown ? recordSetKey(shown) : null;
  const pending = setKey !== null && certification.pendingSetKey === setKey;
  const notice = certification.notice && certification.notice.setKey === setKey ? certification.notice : null;

  const perform = (action: RecordSetAction, target: RecordSetDetail) => {
    if (action === 'certify') {
      void certification.certify(target);
      return;
    }
    const confirmation = recordSetActionConfirmation(action, target);
    Alert.alert(confirmation.title, confirmation.message, [
      { text: 'Keep', style: 'cancel' },
      {
        text: confirmation.confirmLabel,
        style: 'destructive',
        onPress: () => void (action === 'withdraw' ? certification.withdraw(target) : certification.cancel(target)),
      },
    ]);
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={shown !== null}>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Close set details" onPress={onClose} style={styles.scrim} testID="group-record-sheet-overlay" />
        {shown && model ? (
          <View style={styles.panel} testID="group-record-sheet">
            <ScrollView contentContainerStyle={styles.body}>
              <UiText testID="group-record-sheet-title" variant="title">
                {model.title}
              </UiText>
              <UiText testID="group-record-sheet-value" variant="label">
                {model.valueLabel}
              </UiText>
              {model.loggedLabel ? (
                <UiText testID="group-record-sheet-logged" variant="bodyMuted">
                  {model.loggedLabel}
                </UiText>
              ) : null}
              <UiText testID="group-record-sheet-date" variant="subtitle">
                {model.dateLabel}
              </UiText>
              {model.loggedAsLabel ? (
                <UiText testID="group-record-sheet-logged-as" variant="bodyMuted">
                  {model.loggedAsLabel}
                </UiText>
              ) : null}
              {model.provisionalLabel ? (
                <UiText testID="group-record-sheet-provisional" variant="bodyMuted">
                  {model.provisionalLabel}
                </UiText>
              ) : null}
              <View style={styles.status}>
                <UiText testID="group-record-sheet-status" variant="label">
                  {model.statusLabel}
                </UiText>
                {model.lifterNote ? (
                  <UiText testID="group-record-sheet-lifter-note" variant="bodyMuted">
                    {model.lifterNote}
                  </UiText>
                ) : null}
              </View>
              {notice ? (
                <GroupWriteNotice message={notice.message} testID="group-record-sheet-notice" tone={notice.tone} />
              ) : null}
              {model.actions.map((action) => (
                <UiButton
                  disabled={pending}
                  key={action}
                  label={RECORD_SET_ACTION_LABELS[action]}
                  onPress={() => perform(action, shown)}
                  testID={`group-record-sheet-${action}`}
                  variant={DESTRUCTIVE_RECORD_SET_ACTIONS.has(action) ? 'danger' : 'primary'}
                />
              ))}
              {model.canViewSession ? (
                <UiButton
                  label="View full session"
                  onPress={() => {
                    onClose();
                    router.push(`/group-session/${shown.member.user_id}/${shown.sessionId}`);
                  }}
                  testID="group-record-sheet-view-session"
                  variant="secondary"
                />
              ) : null}
              <UiButton label="Close" onPress={onClose} testID="group-record-sheet-close" variant="secondary" />
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  panel: {
    maxHeight: '85%',
    borderTopLeftRadius: uiRadius.md,
    borderTopRightRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
  },
  body: {
    gap: uiSpace.sm,
    padding: uiSpace.xl,
    paddingBottom: uiSpace.xl * 2,
  },
  status: {
    gap: uiSpace.xs,
    paddingTop: uiSpace.xs,
  },
});
