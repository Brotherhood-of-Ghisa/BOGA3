import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { SessionGpsPanel, type SessionGpsPanelProps } from './session-gps-panel';
import type { SessionGymOption } from '@/src/session-recorder/gym-options';

// The list may take most of the screen; the sheet's handle and title stay.
const LIST_SHARE_OF_SCREEN = 0.55;

type SessionGymSheetProps = {
  visible: boolean;
  // `null` while loading.
  options: SessionGymOption[] | null;
  // The gyms near the session's fix, nearest first, once the position the
  // recorder acquired resolves; empty otherwise. Suggests, never selects.
  suggestions: SessionGymOption[];
  selectedGymId: string | null;
  onSelect: (gym: SessionGymOption | null) => void;
  onManage: () => void;
  onDismiss: () => void;
  // The developer GPS panel's inputs; `gpsPanel` is undefined unless the
  // developer-mode flag is on, and the panel never renders without it.
  gpsPanel?: SessionGpsPanelProps | null;
};

// Picks the session's gym. Nearby gyms come first as `Nearby · <gym>` (they
// suggest, never select), then No gym and every gym with the current one
// marked. `Manage gyms` leaves for the Gyms screen.
export function SessionGymSheet({
  visible,
  options,
  suggestions,
  selectedGymId,
  onSelect,
  onManage,
  onDismiss,
  gpsPanel,
}: SessionGymSheetProps) {
  const { height } = useWindowDimensions();
  // Suggesting the gym the session already has would say nothing; its
  // neighbour still says something when two gyms share a site.
  const nearby = options === null ? [] : suggestions.filter((suggestion) => suggestion.id !== selectedGymId);

  const row = (gym: SessionGymOption | null, index: number) => {
    const isSelected = (gym?.id ?? null) === selectedGymId;
    return (
      <ListRow
        accessibilityLabel={gym ? `Select gym ${gym.name}` : 'Select no gym'}
        divider={index > 0 || nearby.length > 0}
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
      {gpsPanel ? (
        <SessionGpsPanel nearbyGymCount={gpsPanel.nearbyGymCount} state={gpsPanel.state} suggestionCount={gpsPanel.suggestionCount} />
      ) : null}
      <ScrollView style={{ maxHeight: height * LIST_SHARE_OF_SCREEN }} testID="session-view-gym-list">
        {options === null ? (
          <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted, styles.message]}>Loading gyms…</Text>
        ) : (
          <>
            {nearby.map((gym, index) => (
              <ListRow
                accessibilityLabel={`Select nearby gym ${gym.name}`}
                divider={index > 0}
                key={gym.id}
                label={`Nearby · ${gym.name}`}
                leading={<Icon color={uiRoles.accent} name="location" />}
                onPress={() => onSelect(gym)}
                testID={index === 0 ? 'session-view-gym-suggestion' : `session-view-gym-suggestion-${gym.id}`}
              />
            ))}
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
        <Text allowFontScaling={false} style={[uiText.label, uiTextTone.ink]}>Manage gyms</Text>
      </ListRow>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  message: {
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
  },
});
