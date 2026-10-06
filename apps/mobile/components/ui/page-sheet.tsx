import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type PageSheetHeaderProps = {
  title: string;
  // Called by the X.
  onClose: () => void;
  // Accessibility label of the X, e.g. `Close swap exercise`.
  closeLabel: string;
  // While a write is in flight the X is disabled.
  closeDisabled?: boolean;
  // Controls before the X, usually `IconButton`s (the exercise picker's Manage
  // and Add new).
  actions?: ReactNode;
  // On the title row.
  testID?: string;
  // On the X.
  closeTestID?: string;
};

// A sub-page's grabber and title row: the title, its actions, then the X. Shared
// by `PageSheet` and the exercise picker route, so every sub-page reads alike.
export function PageSheetHeader({
  title,
  onClose,
  closeLabel,
  closeDisabled = false,
  actions,
  testID,
  closeTestID,
}: PageSheetHeaderProps) {
  return (
    <>
      {/* The page sheet's own grabber: swiping down closes it. */}
      <View style={styles.handleArea}>
        <View style={styles.handle} />
      </View>
      <View style={styles.header} testID={testID}>
        <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {actions}
        <IconButton
          accessibilityLabel={closeLabel}
          disabled={closeDisabled}
          name="x"
          onPress={onClose}
          testID={closeTestID}
        />
      </View>
    </>
  );
}

export type PageSheetProps = {
  visible: boolean;
  // Called by the X, a swipe down anywhere on the sheet (iOS), Android Back and
  // the VoiceOver escape gesture. It must close the sheet (`visible` false): a
  // swipe has already taken it off screen. Use `dismissDisabled` to refuse.
  onDismiss: () => void;
  // Called once the sheet has gone after `visible` turns false, so a native
  // `Alert` or a push that follows never collides with it.
  onDismissed?: () => void;
  title: string;
  // Accessibility label of the X, e.g. `Close swap exercise`.
  closeLabel: string;
  headerActions?: ReactNode;
  // While the sheet's own write or capture is in flight: the swipe springs back,
  // the X is disabled and Back / escape do nothing.
  dismissDisabled?: boolean;
  // The body fills the rest of the sheet; a long one scrolls.
  children: ReactNode;
  // `<testID>` on the sheet's content, `<testID>-header` on the title row,
  // `<testID>-close` on the X, `<testID>-modal` on the native modal.
  testID?: string;
};

// A sub-page: a browser, an editor or a preview, opened over the current screen
// as a native iOS page sheet — the exercise picker's presentation — while staying
// state within its route (`ux-rules.md` "Sheets"). The screen behind recedes
// into a card; the sheet closes by swiping down from anywhere or its X.
export function PageSheet({
  visible,
  onDismiss,
  onDismissed,
  title,
  closeLabel,
  headerActions,
  dismissDisabled = false,
  children,
  testID,
}: PageSheetProps) {
  const insets = useSafeAreaInsets();
  // A swipe dismisses the native sheet before React hears of it, and the native
  // modal then never presents again. A swiped modal is replaced by a fresh one
  // (`instance`) once the host has hidden it.
  const [instance, setInstance] = useState(0);
  const swipedInstance = useRef<number | null>(null);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (wasVisible.current && !visible) {
      if (swipedInstance.current !== null) {
        setInstance((current) => current + 1);
        onDismissed?.();
      } else if (Platform.OS !== 'ios') {
        // Android has no `Modal.onDismiss`; its modal is gone once hidden.
        onDismissed?.();
      }
    }
    if (visible) swipedInstance.current = null;
    wasVisible.current = visible;
  }, [visible, onDismissed]);

  const dismiss = useCallback(() => {
    if (!dismissDisabled) onDismiss();
  }, [dismissDisabled, onDismiss]);
  // iOS sends this only for a completed swipe (never while `dismissDisabled`);
  // Android for Back.
  const handleRequestClose = useCallback(() => {
    if (Platform.OS === 'ios') {
      swipedInstance.current = instance;
      onDismiss();
      return;
    }
    dismiss();
  }, [dismiss, instance, onDismiss]);
  const handleNativeDismiss = useCallback(() => {
    // A swiped sheet reported its dismissal when the host hid it.
    if (swipedInstance.current !== instance) onDismissed?.();
  }, [instance, onDismissed]);

  return (
    <Modal
      allowSwipeDismissal={!dismissDisabled}
      animationType="slide"
      key={instance}
      onDismiss={Platform.OS === 'ios' ? handleNativeDismiss : undefined}
      onRequestClose={handleRequestClose}
      presentationStyle="pageSheet"
      testID={testID ? `${testID}-modal` : undefined}
      visible={visible}>
      {/* A modal is its own native root: gestures inside it need their own root view. */}
      <GestureHandlerRootView style={styles.root}>
        <View
          onAccessibilityEscape={dismiss}
          style={[styles.sheet, { paddingBottom: insets.bottom }]}
          testID={testID}>
          <PageSheetHeader
            actions={headerActions}
            closeDisabled={dismissDisabled}
            closeLabel={closeLabel}
            closeTestID={testID ? `${testID}-close` : undefined}
            onClose={dismiss}
            testID={testID ? `${testID}-header` : undefined}
            title={title}
          />
          {children}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    backgroundColor: uiRoles.surface,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  handle: {
    width: uiGeometry.sheetHandle.width,
    height: uiGeometry.sheetHandle.height,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.rule,
  },
  // As the Sheet's title row: the controls bring their own 44pt targets.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: uiSpace.lg,
    paddingRight: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  title: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
