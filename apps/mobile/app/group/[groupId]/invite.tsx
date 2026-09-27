import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';

import {
  GroupLoadingState,
  GroupStateView,
  GroupWriteNotice,
  GroupsSignInRequired,
  groupScreenStyles,
} from '@/components/groups';
import {
  ActionButton,
  Card,
  ScreenScroll,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  buildGroupInviteShareMessage,
  canManageGroup,
  describeGroupWriteError,
  getGroup,
  getGroupInviteCode,
  groupCacheKeys,
  groupInviteLink,
  regenerateGroupInviteCode,
  useGroupAction,
  useGroupResource,
  type GroupGetResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

const MEMBERS_CANNOT_INVITE = 'Only the owner and admins can see and share the invite code.';

/**
 * The invite (groups contract §6.3, card flow 2): owner and admins only
 * (C7.4). The code is read online and never cached; Share uses React Native
 * core `Share.share`; Regenerate is confirmed because the old code stops working.
 * The code is a Plex Mono figure (T13-D3); `Share invite` is the one `accent`.
 */
export default function GroupInviteRoute() {
  const { isConfigured, user } = useAuth();
  const groupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId) {
    return null;
  }
  return <GroupInviteContent groupId={groupId} userId={user.id} />;
}

type Feedback = { tone: 'error' | 'success'; message: string };

function GroupInviteContent({ userId, groupId }: { userId: string; groupId: string }) {
  const fetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const load = useGroupAction(getGroupInviteCode);
  const regenerate = useGroupAction(regenerateGroupInviteCode);
  const [code, setCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const role = group.data?.group.my_role ?? null;
  const allowed = role === null || canManageGroup(role);

  const runLoad = load.run;
  const loadCode = useCallback(async () => {
    const result = await runLoad(groupId);
    if (result.ok) setCode(result.value.code);
  }, [groupId, runLoad]);

  useEffect(() => {
    if (allowed) void loadCode();
  }, [allowed, loadCode]);

  if (group.lostAccess) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupStateView testID="group-invite-lost-access" title="You're no longer a member of this group" />
      </View>
    );
  }
  if (!allowed || load.error?.code === 'FORBIDDEN') {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupStateView body={MEMBERS_CANNOT_INVITE} testID="group-invite-forbidden" title="Invites are for admins" />
      </View>
    );
  }

  const groupName = group.data?.group.name ?? null;

  const onShare = async () => {
    if (!code) return;
    try {
      await Share.share({ message: buildGroupInviteShareMessage(groupName, code) });
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : "Couldn't open the share sheet." });
    }
  };

  const onRegenerate = async () => {
    setFeedback(null);
    const result = await regenerate.run(groupId);
    if (result.ok) {
      setCode(result.value.code);
      setFeedback({ tone: 'success', message: 'New code ready. The old code no longer works.' });
    } else {
      setFeedback({ tone: 'error', message: describeGroupWriteError(result.error) });
    }
  };

  const confirmRegenerate = () => {
    Alert.alert('Regenerate the invite code?', 'The old code stops working. Anyone who has it will need the new one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Regenerate', style: 'destructive', onPress: () => void onRegenerate() },
    ]);
  };

  let codeArea = <GroupLoadingState testID="group-invite-loading" />;
  if (code) {
    codeArea = (
      <>
        <Text
          allowFontScaling={false}
          accessibilityLabel={`Invite code ${code.split('').join(' ')}`}
          selectable
          style={styles.code}
          testID="group-invite-code">
          {code}
        </Text>
        <Text allowFontScaling={false} selectable style={styles.link} testID="group-invite-link">
          {groupInviteLink(code)}
        </Text>
      </>
    );
  } else if (load.error) {
    codeArea = (
      <>
        <GroupWriteNotice message={describeGroupWriteError(load.error)} testID="group-invite-load-error" tone="error" />
        <ActionButton label="Retry" onPress={() => void loadCode()} testID="group-invite-retry" variant="outline" />
      </>
    );
  }

  return (
    <ScreenScroll testID="group-invite-screen">
      <Card style={styles.card}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.title}>
          {groupName ? `Invite friends to ${groupName}` : 'Invite friends'}
        </Text>
        <Text allowFontScaling={false} style={styles.body}>
          Anyone with this code can join. It works until you regenerate it.
        </Text>
        {codeArea}
      </Card>
      {feedback ? <GroupWriteNotice message={feedback.message} testID="group-invite-feedback" tone={feedback.tone} /> : null}
      <ActionButton disabled={!code} label="Share invite" onPress={() => void onShare()} testID="group-invite-share" variant="primary" />
      <ActionButton
        disabled={!code || regenerate.pending}
        label={regenerate.pending ? 'Regenerating…' : 'Regenerate code'}
        onPress={confirmRegenerate}
        testID="group-invite-regenerate"
        tone="danger"
        variant="outline"
      />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  // A figure (T13-D3): Plex Mono 700, spaced so each character reads apart.
  code: {
    paddingVertical: uiSpace.md,
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    letterSpacing: uiSpace.xs,
    textAlign: 'center',
    color: uiRoles.ink,
  },
  link: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    textAlign: 'center',
    color: uiRoles.inkMuted,
  },
});
