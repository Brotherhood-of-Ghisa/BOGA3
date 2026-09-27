import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  GroupLoadingState,
  GroupWriteNotice,
  GroupsSignInRequired,
  UsernameGate,
  useUsernameGate,
} from '@/components/groups';
import {
  ActionButton,
  Card,
  FormField,
  ScreenScroll,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  describeGroupWriteError,
  formatMemberCount,
  joinGroup,
  previewGroupInvite,
  useGroupAction,
  type GroupInvitePreviewResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string =>
  ((Array.isArray(value) ? value[0] : value) ?? '').trim();

/**
 * Join a group (groups contract §6.3, card flow 3). `boga3://group/join?code=…`
 * opens here with the code prefilled and previewed; a new link remounts the
 * screen with its own code. The code is a figure (a Plex Mono field); the
 * preview `Card`'s `Join group` is the screen's one `accent`.
 */
export default function JoinGroupRoute() {
  const { isConfigured, user } = useAuth();
  const code = firstParam(useLocalSearchParams<{ code?: string | string[] }>().code);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  return <JoinGroupContent initialCode={code} key={code} userId={user.id} />;
}

function JoinGroupContent({ userId, initialCode }: { userId: string; initialCode: string }) {
  const router = useRouter();
  const gate = useUsernameGate(userId);
  const [code, setCode] = useState(initialCode);
  const [codeMissing, setCodeMissing] = useState(false);
  const [preview, setPreview] = useState<GroupInvitePreviewResult | null>(null);
  const lookup = useGroupAction(previewGroupInvite);
  const join = useGroupAction(joinGroup);
  const autoPreviewed = useRef(false);

  const { run: runLookup } = lookup;
  const { reset: resetJoin } = join;
  const runPreview = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        setCodeMissing(true);
        return;
      }
      setCodeMissing(false);
      resetJoin();
      const result = await runLookup(trimmed);
      setPreview(result.ok ? result.value : null);
    },
    [resetJoin, runLookup],
  );

  // A link's code is previewed as soon as the gate lets the form show.
  useEffect(() => {
    if (gate.status === 'ready' && initialCode.length > 0 && !autoPreviewed.current) {
      autoPreviewed.current = true;
      void runPreview(initialCode);
    }
  }, [gate.status, initialCode, runPreview]);

  const onJoin = async () => {
    if (!preview) return;
    if (preview.already_member) {
      router.replace(`/group/${preview.group_id}`);
      return;
    }
    const result = await join.run(code.trim());
    if (result.ok) {
      // Joined, or already a member (joined: false) — either way the group opens.
      router.replace(`/group/${result.value.group_id}`);
      return;
    }
    if (result.error.code === 'USERNAME_REQUIRED') {
      gate.require('Set a username before joining a group.');
    } else if (result.error.code === 'INVITE_INVALID') {
      setPreview(null);
    }
  };

  const onChangeCode = (value: string) => {
    setCode(value);
    setPreview(null);
    lookup.reset();
    join.reset();
  };

  const failure = join.error ?? lookup.error;
  const failureMessage = codeMissing
    ? 'Enter the invite code.'
    : failure && failure.code !== 'USERNAME_REQUIRED'
      ? describeGroupWriteError(failure)
      : null;
  const busy = lookup.pending || join.pending;

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="group-join-screen">
      {gate.status === 'checking' ? <GroupLoadingState testID="group-join-loading" /> : null}
      {gate.status === 'required' ? <UsernameGate notice={gate.notice} onSaved={gate.complete} userId={userId} /> : null}
      {gate.status === 'ready' ? (
        <>
          <View style={styles.form} testID="group-join-form">
            <FormField
              accessibilityLabel="Invite code"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              label="Invite code"
              onChangeText={onChangeCode}
              onSubmitEditing={() => void runPreview(code)}
              placeholder="8-character code"
              returnKeyType="go"
              testID="group-join-code-input"
              value={code}
            />
            {failureMessage ? <GroupWriteNotice message={failureMessage} testID="group-join-error" tone="error" /> : null}
            {preview ? null : (
              <ActionButton
                disabled={busy}
                label={lookup.pending ? 'Checking…' : 'Find group'}
                onPress={() => void runPreview(code)}
                testID="group-join-preview-button"
                variant="outline"
              />
            )}
          </View>
          {preview ? (
            <Card style={styles.preview} testID="group-join-preview">
              <Text allowFontScaling={false} accessibilityRole="header" style={styles.name} testID="group-join-preview-name">
                {preview.name}
              </Text>
              <Text allowFontScaling={false} style={styles.meta} testID="group-join-preview-meta">
                {preview.already_member
                  ? `${formatMemberCount(preview.member_count)} · You're already a member`
                  : formatMemberCount(preview.member_count)}
              </Text>
              <View style={styles.previewAction}>
                <ActionButton
                  disabled={busy}
                  label={preview.already_member ? 'Open group' : join.pending ? 'Joining…' : 'Join group'}
                  onPress={() => void onJoin()}
                  testID="group-join-submit"
                  variant="primary"
                />
              </View>
            </Card>
          ) : null}
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: uiSpace.md,
  },
  preview: {
    padding: uiSpace.md,
    gap: uiSpace.xs,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  previewAction: {
    marginTop: uiSpace.sm,
  },
});
