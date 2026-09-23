import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionGymOption } from '@/src/session-recorder/gym-options';

// The list may take most of the screen; the sheet's handle and title stay.
const LIST_SHARE_OF_SCREEN = 0.6;

type SessionGymSheetProps = {
  visible: boolean;
  // `null` while loading.
  options: SessionGymOption[] | null;
  selectedGymId: string | null;
  onSelect: (gym: SessionGymOption | null) => void;
  onDismiss: () => void;
};

// Picks the session's gym: No gym, then the recorder picker's gyms, the current
// one marked. Selection only; adding and managing gyms stay in the recorder.
export function SessionGymSheet({ visible, options, selectedGymId, onSelect, onDismiss }: SessionGymSheetProps) {
  const { height } = useWindowDimensions();

  const row = (gym: SessionGymOption | null, index: number) => {
    const isSelected = (gym?.id ?? null) === selectedGymId;
    return (
      <ListRow
        accessibilityLabel={gym ? `Select gym ${gym.name}` : 'Select no gym'}
        divider={index > 0}
        key={gym?.id ?? 'none'}
        label={gym?.name ?? 'No gym'}
        onPress={() => onSelect(gym)}
        selected={isSelected}
        testID={gym ? `session-view-gym-option-${gym.id}` : 'session-view-gym-option-none'}
        trailing={isSelected ? <Icon color={uiRoles.accent} name="check" /> : undefined}
      />
    );
  };

  return (
    <Sheet dismissLabel="Dismiss gym picker" onDismiss={onDismiss} testID="session-view-gym-sheet" title="Gym" visible={visible}>
      <ScrollView style={{ maxHeight: height * LIST_SHARE_OF_SCREEN }} testID="session-view-gym-list">
        {options === null ? (
          <Text style={styles.message}>Loading gyms…</Text>
        ) : (
          [null, ...options].map(row)
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  message: {
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
