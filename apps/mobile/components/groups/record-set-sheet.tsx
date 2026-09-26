import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Icon,
  ListRow,
  Sheet,
  Stat,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
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

import { GroupCertificationStatus } from './certification-status';
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
 * record cards: a `Sheet` (G5) with the values, the as-logged value when
 * converted, date and gym, "Logged as", the certification line, and the
 * certification actions my relationship to the set allows (08 pattern 11):
 * `Certify` is the sheet's one primary, a removal a `danger` row. The backdrop
 * dismisses it; there is no Close. Every write is online-only; removals confirm
 * first.
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
    <Sheet
      dismissLabel="Close set details"
      onDismiss={onClose}
      testID="group-record-sheet"
      title={model?.title}
      visible={shown !== null}>
      {shown && model ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.facts}>
            <View accessibilityLabel={model.valueLabel} accessible style={styles.figures} testID="group-record-sheet-value">
              <Stat emphasis="record" label="Set" value={model.setFigure} />
              {model.oneRepMaxFigure ? <Stat emphasis="record" label="1RM" value={model.oneRepMaxFigure} /> : null}
            </View>
            {model.loggedLabel ? (
              <Text allowFontScaling={false} style={styles.muted} testID="group-record-sheet-logged">
                {model.loggedLabel}
              </Text>
            ) : null}
            <Text allowFontScaling={false} style={styles.line} testID="group-record-sheet-date">
              {model.dateLabel}
            </Text>
            {model.loggedAsLabel ? (
              <Text allowFontScaling={false} style={styles.muted} testID="group-record-sheet-logged-as">
                {model.loggedAsLabel}
              </Text>
            ) : null}
            {model.provisionalLabel ? (
              <Text allowFontScaling={false} style={styles.muted} testID="group-record-sheet-provisional">
                {model.provisionalLabel}
              </Text>
            ) : null}
            <View style={styles.status}>
              <GroupCertificationStatus
                label={model.statusLabel}
                status={model.status}
                testID="group-record-sheet-status"
              />
              {model.lifterNote ? (
                <Text allowFontScaling={false} style={styles.muted} testID="group-record-sheet-lifter-note">
                  {model.lifterNote}
                </Text>
              ) : null}
            </View>
            {notice ? (
              <GroupWriteNotice message={notice.message} testID="group-record-sheet-notice" tone={notice.tone} />
            ) : null}
            {model.actions.includes('certify') ? (
              <ActionButton
                disabled={pending}
                label={RECORD_SET_ACTION_LABELS.certify}
                onPress={() => perform('certify', shown)}
                testID="group-record-sheet-certify"
                variant="primary"
              />
            ) : null}
          </View>
          <View>
            {model.actions
              .filter((action) => DESTRUCTIVE_RECORD_SET_ACTIONS.has(action))
              .map((action) => (
                <ListRow
                  disabled={pending}
                  key={action}
                  label={RECORD_SET_ACTION_LABELS[action]}
                  onPress={() => perform(action, shown)}
                  testID={`group-record-sheet-${action}`}
                  tone="danger"
                />
              ))}
            {model.canViewSession ? (
              <ListRow
                label="View full session"
                onPress={() => {
                  onClose();
                  router.push(`/group-session/${shown.member.user_id}/${shown.sessionId}`);
                }}
                testID="group-record-sheet-view-session"
                trailing={<Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />}
              />
            ) : null}
          </View>
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: uiSpace.sm,
  },
  facts: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  figures: {
    flexDirection: 'row',
    gap: uiSpace.xl,
  },
  line: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  status: {
    gap: uiSpace.xs,
    paddingTop: uiSpace.xs,
  },
});
