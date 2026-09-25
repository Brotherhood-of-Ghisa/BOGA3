import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
  // Usually `ListRow`s.
  children: ReactNode;
  // `<testID>` on the panel, `<testID>-backdrop` on the backdrop.
  testID?: string;
};

// A design-language bottom sheet: anchored to the bottom edge over a dimmed
// backdrop, with a handle and an optional title.
export function Sheet({ visible, onDismiss, dismissLabel, title, children, testID }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} transparent visible={visible}>
      <View style={styles.root}>
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
          {title ? (
            <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
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
  title: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
