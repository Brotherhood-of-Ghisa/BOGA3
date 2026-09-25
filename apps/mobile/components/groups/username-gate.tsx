import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors } from '@/components/ui';
import { loadUserProfile, saveUsername } from '@/src/auth/profile';
import { describeGroupWriteError, useGroupAction } from '@/src/groups';

import { groupFormStyles } from './screen-styles';
import { GroupWriteNotice } from './write-notice';

export type UsernameGateStatus = 'checking' | 'required' | 'ready';

export type UsernameGateState = {
  status: UsernameGateStatus;
  /** Why the gate re-opened (the server's `USERNAME_REQUIRED`), shown inside it. */
  notice: string | null;
  /** Re-open the gate, e.g. after the server refused with `USERNAME_REQUIRED`. */
  require: (notice?: string) => void;
  complete: () => void;
};

/**
 * Contract §6.3 username gate (C3.1): create and join load the profile first,
 * and a blank username shows the inline field before the form. A profile that
 * cannot be loaded does not block the form — the server enforces
 * `USERNAME_REQUIRED`, which re-opens the gate.
 */
export function useUsernameGate(userId: string): UsernameGateState {
  const [status, setStatus] = useState<UsernameGateStatus>('checking');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadUserProfile(userId).then(
      ({ profile }) => {
        if (cancelled) return;
        setStatus((profile.username ?? '').trim().length > 0 ? 'ready' : 'required');
      },
      () => {
        if (!cancelled) setStatus('ready');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const require = useCallback((nextNotice?: string) => {
    setNotice(nextNotice ?? null);
    setStatus('required');
  }, []);
  const complete = useCallback(() => {
    setNotice(null);
    setStatus('ready');
  }, []);

  return { status, notice, require, complete };
}

type UsernameGateProps = {
  userId: string;
  notice: string | null;
  onSaved: () => void;
};

/** The inline username field shown before create / join when the username is blank. */
export function UsernameGate({ userId, notice, onSaved }: UsernameGateProps) {
  const [username, setUsername] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useGroupAction((value: string) => saveUsername(userId, value));

  const onSave = async () => {
    const trimmed = username.trim();
    if (trimmed.length === 0) {
      setValidationError('Enter a username.');
      return;
    }
    setValidationError(null);
    const result = await save.run(trimmed);
    if (result.ok) onSaved();
  };

  const fieldError = validationError ?? (save.error ? describeGroupWriteError(save.error) : null);

  return (
    <UiSurface style={groupFormStyles.card} testID="group-username-gate">
      <UiText variant="title">Choose a username</UiText>
      <UiText variant="bodyMuted">Group members see you by your username. You can change it later in Profile.</UiText>
      {notice ? <GroupWriteNotice message={notice} testID="group-username-gate-notice" tone="error" /> : null}
      <View style={groupFormStyles.field}>
        <UiText variant="subtitle">Username</UiText>
        <TextInput
          allowFontScaling={false}
          accessibilityLabel="Username"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!save.pending}
          onChangeText={setUsername}
          onSubmitEditing={() => void onSave()}
          placeholder="e.g. alex"
          placeholderTextColor={uiColors.textDisabled}
          returnKeyType="done"
          style={groupFormStyles.input}
          testID="group-username-input"
          textContentType="username"
          value={username}
        />
        {fieldError ? (
          <UiText accessibilityRole="alert" style={groupFormStyles.fieldError} testID="group-username-error" variant="label">
            {fieldError}
          </UiText>
        ) : null}
      </View>
      <UiButton
        disabled={save.pending}
        label={save.pending ? 'Saving…' : 'Save username'}
        onPress={() => void onSave()}
        testID="group-username-save"
      />
    </UiSurface>
  );
}
