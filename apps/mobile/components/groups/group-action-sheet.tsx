import { StyleSheet, Text } from 'react-native';

import { ListRow, Sheet, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';

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
  /** Accessibility label of the backdrop. */
  dismissLabel: string;
  /** `<prefix>-sheet` on the panel, `<prefix>-sheet-backdrop` on the backdrop. */
  testIDPrefix: string;
  /** `<actionTestIDPrefix>-<key>` on each action row. */
  actionTestIDPrefix: string;
};

/**
 * A `Sheet` offering a short list of actions on one item (a member, a group
 * exercise): the title and subtitle, then one row per action, `danger` when
 * destructive. No Cancel: the backdrop dismisses it (G5).
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
    <Sheet dismissLabel={dismissLabel} onDismiss={onClose} testID={`${testIDPrefix}-sheet`} title={title} visible={visible}>
      {subtitle ? (
        <Text allowFontScaling={false} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
      {actions.map((action) => (
        <ListRow
          key={action.key}
          label={action.label}
          onPress={() => onSelect(action.key)}
          testID={`${actionTestIDPrefix}-${action.key}`}
          tone={action.destructive ? 'danger' : 'default'}
        />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Sits under the title, which keeps its own bottom padding.
  subtitle: {
    marginTop: -uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
