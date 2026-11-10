import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RadioRow } from '@/components/ui/form-rows';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useUiText } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';

export type HeaderTitleOption<Id extends string> = { id: Id; label: string };

export type HeaderTitleMenuProps<Id extends string> = {
  options: readonly HeaderTitleOption<Id>[];
  currentId: Id;
  onChoose: (id: Id) => void;
  // The sheet's title, and what VoiceOver says the button switches: `Colour`.
  sheetTitle: string;
  testID: string;
};

// Wide enough for a short name, and clear of the back arrow and one header
// control on a 375pt phone.
const TITLE_MAX_WIDTH = 220;

/**
 * A native header title that switches the page between sibling options: the
 * current option's label in the sheet-title role and a chevron. A tap opens a
 * sheet of radio rows, the current one checked; choosing another calls
 * `onChoose` (the caller swaps the page in place), choosing the current one
 * only closes the sheet.
 */
export function HeaderTitleMenu<Id extends string>({ options, currentId, onChoose, sheetTitle, testID }: HeaderTitleMenuProps<Id>) {
  const text = useUiText();
  const [open, setOpen] = useState(false);
  const title = options.find((option) => option.id === currentId)?.label ?? '';
  const choose = (id: Id) => {
    setOpen(false);
    if (id !== currentId) onChoose(id);
  };
  return (
    <>
      <Pressable
        accessibilityHint={`Switches to another ${sheetTitle.toLowerCase()}`}
        accessibilityLabel={`${title}, switch ${sheetTitle.toLowerCase()}`}
        accessibilityRole="button"
        hitSlop={uiSpace.sm}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.root, pressed ? styles.pressed : null]}
        testID={testID}>
        <Text allowFontScaling={false} numberOfLines={1} style={[text.sheetTitle, styles.text]}>
          {title}
        </Text>
        <Icon colorRole="inkMuted" name="chevron-down" size="sm" />
      </Pressable>
      <Sheet dismissLabel={`Dismiss ${sheetTitle.toLowerCase()}`} onDismiss={() => setOpen(false)} testID={`${testID}-sheet`}
        title={sheetTitle} visible={open}>
        <View style={styles.content}>
          {options.map((option, index) => (
            <RadioRow
              checked={option.id === currentId}
              divider={index > 0}
              key={option.id}
              label={option.label}
              onPress={() => choose(option.id)}
              testID={`${testID}-option-${option.id}`}
            />
          ))}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    maxWidth: TITLE_MAX_WIDTH,
  },
  pressed: { opacity: 0.6 },
  text: { flexShrink: 1 },
  content: { paddingBottom: uiSpace.lg },
});
