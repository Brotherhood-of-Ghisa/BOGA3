import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { UiButton, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';

export type GroupActionSheetItem<TKey extends string> = {
  key: TKey;
  label: string;
  /** Danger styling; the caller confirms it (08 destructive action safety pattern). */
  destructive: boolean;
};

type GroupActionSheetProps<TKey extends string> = {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: GroupActionSheetItem<TKey>[];
  onSelect: (key: TKey) => void;
  onClose: () => void;
  /** Accessibility label of the scrim. */
  dismissLabel: string;
  /** `<prefix>-sheet`, `<prefix>-overlay`, `<prefix>-cancel`. */
  testIDPrefix: string;
  /** `<actionTestIDPrefix>-<key>` on each action button. */
  actionTestIDPrefix: string;
};

/**
 * An in-route bottom panel offering a short list of actions on one item (a
 * member, a group exercise), then Cancel. Destructive actions use danger
 * styling.
 */
export function GroupActionSheet<TKey extends string>({
  visible,
  title,
  subtitle,
  actions,
  onSelect,
  onClose,
  dismissLabel,
  testIDPrefix,
  actionTestIDPrefix,
}: GroupActionSheetProps<TKey>) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.root}>
        <Pressable accessibilityLabel={dismissLabel} onPress={onClose} style={styles.scrim} testID={`${testIDPrefix}-overlay`} />
        {visible ? (
          <View style={styles.panel} testID={`${testIDPrefix}-sheet`}>
            <UiText numberOfLines={1} variant="title">
              {title}
            </UiText>
            {subtitle ? <UiText variant="subtitle">{subtitle}</UiText> : null}
            {actions.map((action) => (
              <UiButton
                key={action.key}
                label={action.label}
                onPress={() => onSelect(action.key)}
                testID={`${actionTestIDPrefix}-${action.key}`}
                variant={action.destructive ? 'danger' : 'secondary'}
              />
            ))}
            <UiButton label="Cancel" onPress={onClose} testID={`${testIDPrefix}-cancel`} variant="secondary" />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  panel: {
    gap: uiSpace.sm,
    padding: uiSpace.screen,
    paddingBottom: uiSpace.screen * 2,
    borderTopLeftRadius: uiRadius.xl,
    borderTopRightRadius: uiRadius.xl,
    backgroundColor: uiColors.surfaceDefault,
  },
});
