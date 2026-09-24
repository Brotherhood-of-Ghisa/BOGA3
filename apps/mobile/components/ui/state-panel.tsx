import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

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
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {body ? <Text style={styles.body}>{body}</Text> : null}
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
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
    textAlign: 'center',
  },
});
