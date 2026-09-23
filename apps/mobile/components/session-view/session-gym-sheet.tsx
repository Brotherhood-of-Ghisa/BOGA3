import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionGymOption } from '@/src/session-recorder/gym-options';

// The list may take most of the screen; the sheet's handle and title stay.
const LIST_SHARE_OF_SCREEN = 0.55;

type SessionGymSheetProps = {
  visible: boolean;
  // `null` while loading.
  options: SessionGymOption[] | null;
  // The one gym that confidently matches the current position, once the
  // lookup the screen started on open resolves; `null` otherwise.
  suggestion: SessionGymOption | null;
  selectedGymId: string | null;
  onSelect: (gym: SessionGymOption | null) => void;
  onManage: () => void;
  onDismiss: () => void;
};

// Picks the session's gym. A confident GPS match comes first as `Nearby ·
// <gym>` (it suggests, never selects), then No gym and every gym with the
// current one marked. `Manage gyms` leaves for the Gyms screen.
export function SessionGymSheet({
  visible,
  options,
  suggestion,
  selectedGymId,
  onSelect,
  onManage,
  onDismiss,
}: SessionGymSheetProps) {
  const { height } = useWindowDimensions();
  // Suggesting the gym the session already has would say nothing.
  const nearby = options !== null && suggestion && suggestion.id !== selectedGymId ? suggestion : null;

  const row = (gym: SessionGymOption | null, index: number) => {
    const isSelected = (gym?.id ?? null) === selectedGymId;
    return (
      <ListRow
        accessibilityLabel={gym ? `Select gym ${gym.name}` : 'Select no gym'}
        divider={index > 0 || nearby !== null}
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
          <>
            {nearby ? (
              <ListRow
                accessibilityLabel={`Select nearby gym ${nearby.name}`}
                divider={false}
                label={`Nearby · ${nearby.name}`}
                leading={<Icon color={uiRoles.accent} name="location" />}
                onPress={() => onSelect(nearby)}
                testID="session-view-gym-suggestion"
              />
            ) : null}
            {[null, ...options].map(row)}
          </>
        )}
      </ScrollView>
      {/* A footer action, not an option: caps control label, like `+ Add exercise`. */}
      <ListRow
        accessibilityLabel="Manage gyms"
        leading={<Icon color={uiRoles.inkMuted} name="settings" />}
        onPress={onManage}
        testID="session-view-gym-manage"
        trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" />}>
        <Text style={styles.manage}>Manage gyms</Text>
      </ListRow>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  manage: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.ink,
  },
  message: {
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
