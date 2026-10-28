import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { uiText } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';

export type StatePanelKind = 'loading' | 'message' | 'error';

export type StatePanelAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

export type StatePanelProps = {
  // `loading` adds a spinner above the words; `error` announces the words when
  // they appear. The look is otherwise one recipe.
  kind?: StatePanelKind;
  title?: string;
  body?: string;
  // Always an outline: a retry or a way out is never the screen's primary
  // (`design-language.md` §5).
  action?: StatePanelAction;
  // Anything the host needs beneath the words, such as its own exit button.
  children?: ReactNode;
  // `true` (default): fills and centres in the space it is given (a whole
  // screen's state). `false`: sits inline, e.g. inside a `Card` or a list.
  fill?: boolean;
  testID?: string;
};

// A screen's or section's loading, empty, error and not-found state: centred
// words on the page ground, an optional spinner and an optional outline action.
export function StatePanel({
  kind = 'message',
  title,
  body,
  action,
  children,
  fill = true,
  testID,
}: StatePanelProps) {
  return (
    <View
      accessibilityLiveRegion={kind === 'message' ? undefined : 'polite'}
      style={[styles.panel, fill ? styles.fill : null]}
      testID={testID}>
      {kind === 'loading' ? <ActivityIndicator color={uiRoles.inkMuted} /> : null}
      {title ? <Text allowFontScaling={false} style={styles.title}>{title}</Text> : null}
      {body ? <Text allowFontScaling={false} style={styles.body}>{body}</Text> : null}
      {action ? (
        <ActionButton
          accessibilityLabel={action.accessibilityLabel}
          label={action.label}
          onPress={action.onPress}
          testID={action.testID}
          variant="outline"
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: uiSpace.lg,
    alignItems: 'center',
    gap: uiSpace.md,
  },
  fill: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...uiText.title,
    textAlign: 'center',
  },
  body: {
    ...uiText.body,
    color: uiRoles.inkMuted,
    textAlign: 'center',
  },
});
