import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SheetProps = {
  visible: boolean;
  // Called for a tap on the backdrop, the Android back button and the VoiceOver
  // escape gesture. There is
  // no Cancel button: tapping outside is the dismissal (`design-language.md` §4).
  onDismiss: () => void;
  // Accessibility label of the backdrop, e.g. `Dismiss options`.
  dismissLabel: string;
  title?: string;
  // One control before the title, usually a `chevron-left` `IconButton` that
  // returns from a panel shown inside the sheet (the exercise editor's muscle
  // selector).
  headerLeading?: ReactNode;
  // Controls on the title's row, right-aligned: usually `IconButton`s (the
  // exercise picker's ⋮, Manage and Add new).
  headerActions?: ReactNode;
  // Lifts the panel above the keyboard, for a sheet with a text field in it.
  keyboardAvoiding?: boolean;
  // Usually `ListRow`s.
  children: ReactNode;
  // `<testID>` on the panel, `<testID>-backdrop` on the backdrop, `<testID>-header`
  // on the title row.
  testID?: string;
};

// A design-language bottom sheet: anchored to the bottom edge over a dimmed
// backdrop, with a handle and an optional title. It never grows past the top of
// the screen: a taller body shrinks to fit, so a tall body should scroll.
export function Sheet({
  visible,
  onDismiss,
  dismissLabel,
  title,
  headerLeading,
  headerActions,
  keyboardAvoiding = false,
  children,
  testID,
}: SheetProps) {
  const insets = useSafeAreaInsets();

  const content = (
    <>
      <Pressable
        accessibilityLabel={dismissLabel}
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.backdrop}
        testID={testID ? `${testID}-backdrop` : undefined}
      />
      {/* Modal to VoiceOver, which then cannot reach the backdrop; the escape
          gesture (two-finger scrub) dismisses instead. */}
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={onDismiss}
        style={[styles.panel, { paddingBottom: Math.max(uiSpace.xl, insets.bottom) }]}
        testID={testID}>
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        {title || headerLeading || headerActions ? (
          <View
            style={[
              styles.header,
              headerActions ? styles.headerWithActions : null,
              headerLeading ? styles.headerWithLeading : null,
            ]}
            testID={testID ? `${testID}-header` : undefined}>
            {headerLeading}
            {title ? (
              <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title}>
                {title}
              </Text>
            ) : null}
            {headerActions ? <View style={styles.headerActions}>{headerActions}</View> : null}
          </View>
        ) : null}
        {children}
      </View>
    </>
  );

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} transparent visible={visible}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.root, { paddingTop: insets.top }]}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.root, { paddingTop: insets.top }]}>{content}</View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiRoles.scrim,
  },
  panel: {
    flexShrink: 1,
    paddingTop: uiSpace.sm,
    borderTopLeftRadius: uiGeometry.radius.sheet,
    borderTopRightRadius: uiGeometry.radius.sheet,
    backgroundColor: uiRoles.surface,
  },
  handleArea: {
    alignItems: 'center',
    paddingBottom: uiSpace.md,
  },
  handle: {
    width: uiGeometry.sheetHandle.width,
    height: uiGeometry.sheetHandle.height,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.ruleStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  // The controls bring their own 44pt target, so the row ends at their edge.
  headerWithActions: {
    paddingRight: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  headerWithLeading: {
    paddingLeft: uiSpace.xs,
    paddingBottom: uiSpace.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
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
