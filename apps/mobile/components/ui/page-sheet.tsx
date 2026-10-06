import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type PageSheetHeaderProps = {
  title: string;
  // A micro-label above the title naming what kind of page it is
  // (`Muscle History`).
  eyebrow?: string;
  // One control before the title, usually a `chevron-left` `IconButton` that
  // returns from a panel shown inside the sheet (the exercise editor's muscle
  // selector).
  leading?: ReactNode;
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
  // On the title.
  titleTestID?: string;
  // On the X.
  closeTestID?: string;
};

// A sub-page's grabber and title row: the title, its actions, then the X. Shared
// by `PageSheet` and the exercise picker route, so every sub-page reads alike.
export function PageSheetHeader({
  title,
  eyebrow,
  leading,
  onClose,
  closeLabel,
  closeDisabled = false,
  actions,
  testID,
  titleTestID,
  closeTestID,
}: PageSheetHeaderProps) {
  return (
    <>
      {/* The page sheet's own grabber: swiping down closes it. */}
      <View style={styles.handleArea}>
        <View style={styles.handle} />
      </View>
      <View style={[styles.header, leading ? styles.headerWithLeading : null]} testID={testID}>
        {leading}
        <View style={styles.titleBlock}>
          {eyebrow ? (
            <Text allowFontScaling={false} style={styles.eyebrow}>
              {eyebrow}
            </Text>
          ) : null}
          {/* Two lines, so a long exercise name wraps rather than truncating. */}
          <Text
            allowFontScaling={false}
            accessibilityRole="header"
            numberOfLines={2}
            style={styles.title}
            testID={titleTestID}>
            {title}
          </Text>
        </View>
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
  eyebrow?: string;
  // Accessibility label of the X, e.g. `Close swap exercise`.
  closeLabel: string;
  // Before the title: a `chevron-left` back from a panel inside the sheet.
  headerLeading?: ReactNode;
  headerActions?: ReactNode;
  // Lifts the body above the keyboard, for a sheet with a footer under its
  // fields (the exercise editor's Save).
  keyboardAvoiding?: boolean;
  // While the sheet's own write or capture is in flight: the swipe springs back,
  // the X is disabled and Back / escape do nothing.
  dismissDisabled?: boolean;
  // The body fills the rest of the sheet; a long one scrolls.
  children: ReactNode;
  // `<testID>` on the sheet's content, `<testID>-header` on the title row,
  // `<testID>-title` on the title, `<testID>-close` on the X, `<testID>-modal`
  // on the native modal.
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
  eyebrow,
  closeLabel,
  headerLeading,
  headerActions,
  keyboardAvoiding = false,
  dismissDisabled = false,
  children,
  testID,
}: PageSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The sheet sits below the top of the window, but `KeyboardAvoidingView`
  // measures itself from the sheet's top: offset it by the gap.
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setSheetHeight(event.nativeEvent.layout.height);
  }, []);
  const keyboardOffset = sheetHeight === null ? 0 : Math.max(0, windowHeight - sheetHeight);
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
          onLayout={handleLayout}
          style={[styles.sheet, { paddingBottom: insets.bottom }]}
          testID={testID}>
          <PageSheetHeader
            actions={headerActions}
            closeDisabled={dismissDisabled}
            closeLabel={closeLabel}
            closeTestID={testID ? `${testID}-close` : undefined}
            eyebrow={eyebrow}
            leading={headerLeading}
            onClose={dismiss}
            testID={testID ? `${testID}-header` : undefined}
            title={title}
            titleTestID={testID ? `${testID}-title` : undefined}
          />
          {keyboardAvoiding ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={keyboardOffset}
              style={styles.body}
              testID={testID ? `${testID}-keyboard` : undefined}>
              {children}
            </KeyboardAvoidingView>
          ) : (
            children
          )}
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
  body: {
    flex: 1,
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
  headerWithLeading: {
    paddingLeft: uiSpace.xs,
  },
  titleBlock: {
    flex: 1,
    gap: uiSpace.xs,
  },
  eyebrow: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
