import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { FormField } from '@/components/ui/form-field';
import { FormError, FormSection } from '@/components/ui/form-section';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiBorder, uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  readGymCoordinates,
  type GymCoordinates,
  type ReadForegroundPosition,
} from '@/src/location/gym-location-reads';
import {
  gymHasSavedLocation,
  saveGym,
  saveGymLocation,
  setGymArchived,
  type GymDirectoryEntry,
} from '@/src/session-recorder/gym-options';

type Feedback = { tone: 'success' | 'error'; message: string };
type Busy = 'location' | 'save' | 'archive' | null;

export type GymEditorProps = {
  // `null` adds a gym.
  gym: GymDirectoryEntry | null;
  // Saved the name (or added the gym), or changed its archive state: the
  // screen closes the editor and reloads.
  onDone: () => void;
  // Saved or cleared the location: the screen reloads, the editor stays open.
  onLocationChanged: () => void;
  // Collapses the editor without saving: its header row, the tapped gym row
  // drawn open (an inline editor has no back, and forms have no Cancel).
  onCancel: () => void;
  // Injected by tests; the native reader by default.
  readPosition?: ReadForegroundPosition;
};

/**
 * One gym's editor, open in place of its row on the Gyms screen (lifted from
 * the old recorder's gym modal). The name saves with Save; the private location
 * saves at once from the current position, and replacing or clearing one asks
 * first. Archive is the synced soft delete, alone at the bottom. Laid out by
 * the form grammar (`ux-rules.md` "Forms"): the name stands alone, the
 * location is a section.
 */
export function GymEditor({ gym, onDone, onLocationChanged, onCancel, readPosition }: GymEditorProps) {
  const [name, setName] = useState(gym?.name ?? '');
  // A new gym's location waits here until the gym is added.
  const [stagedCoordinates, setStagedCoordinates] = useState<GymCoordinates | null>(null);
  const [pending, setPending] = useState<'replace' | 'clear' | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const label = gym ? `gym ${gym.name}` : 'new gym';
  const hasLocation = gym ? gymHasSavedLocation(gym) : stagedCoordinates !== null;
  const trimmedName = name.trim();

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setFeedback(null);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const captureLocation = (mode: 'save' | 'replace') =>
    run('location', async () => {
      setPending(null);
      const read = await readGymCoordinates(readPosition);
      if (read.status === 'error') {
        setFeedback({ tone: 'error', message: read.message });
        return;
      }
      if (!gym) {
        setStagedCoordinates(read.coordinates);
        setFeedback({ tone: 'success', message: 'Location ready. It saves when you add the gym.' });
        return;
      }
      try {
        await saveGymLocation(gym, read.coordinates);
      } catch {
        setFeedback({ tone: 'error', message: "Couldn't save the location. Nothing changed." });
        return;
      }
      setFeedback({ tone: 'success', message: mode === 'replace' ? 'Location replaced.' : 'Location saved.' });
      onLocationChanged();
    });

  const clearLocation = () =>
    run('location', async () => {
      setPending(null);
      if (!gym) return;
      try {
        await saveGymLocation(gym, null);
      } catch {
        setFeedback({ tone: 'error', message: "Couldn't clear the location. Nothing changed." });
        return;
      }
      setFeedback({ tone: 'success', message: "Location cleared. This gym won't be suggested nearby." });
      onLocationChanged();
    });

  const save = () =>
    run('save', async () => {
      if (!trimmedName) return;
      try {
        await saveGym({ gym, name: trimmedName, coordinates: stagedCoordinates });
      } catch {
        setFeedback({ tone: 'error', message: "Couldn't save this gym. Try again." });
        return;
      }
      onDone();
    });

  const toggleArchived = () =>
    run('archive', async () => {
      if (!gym) return;
      try {
        await setGymArchived(gym, !gym.archived);
      } catch {
        setFeedback({
          tone: 'error',
          message: gym.archived ? "Couldn't unarchive this gym. Try again." : "Couldn't archive this gym. Try again.",
        });
        return;
      }
      onDone();
    });

  const isBusy = busy !== null;

  let locationActions;
  if (pending) {
    locationActions = (
      <View style={styles.confirm} testID="gym-editor-confirm">
        <Text allowFontScaling={false} style={uiText.bodyStrong}>
          {pending === 'replace'
            ? 'Replace the saved location with where you are now?'
            : "Clear the saved location? This gym won't be suggested nearby."}
        </Text>
        <View style={styles.buttonRow}>
          <ActionButton
            accessibilityLabel={`Cancel location change for ${label}`}
            label="Cancel"
            onPress={() => setPending(null)}
            testID="gym-editor-location-cancel"
            variant="outline"
          />
          <ActionButton
            accessibilityLabel={
              pending === 'replace' ? `Confirm replace location for ${label}` : `Confirm clear location for ${label}`
            }
            disabled={isBusy}
            label={pending === 'replace' ? 'Replace' : 'Clear'}
            onPress={() => void (pending === 'replace' ? captureLocation('replace') : clearLocation())}
            testID="gym-editor-location-confirm"
            tone={pending === 'clear' ? 'danger' : 'default'}
            variant="outline"
          />
        </View>
      </View>
    );
  } else if (gym && hasLocation) {
    locationActions = (
      <View style={styles.buttonRow}>
        <ActionButton
          accessibilityLabel={`Replace location for ${label}`}
          disabled={isBusy}
          label={busy === 'location' ? 'Saving…' : 'Replace'}
          onPress={() => {
            setFeedback(null);
            setPending('replace');
          }}
          testID="gym-editor-location-replace"
          variant="outline"
        />
        <ActionButton
          accessibilityLabel={`Clear location for ${label}`}
          disabled={isBusy}
          label="Clear"
          onPress={() => {
            setFeedback(null);
            setPending('clear');
          }}
          testID="gym-editor-location-clear"
          tone="danger"
          variant="outline"
        />
      </View>
    );
  } else {
    locationActions = (
      <View style={styles.buttonRow}>
        <ActionButton
          accessibilityLabel={`Save current location for ${label}`}
          disabled={isBusy}
          label={busy === 'location' ? 'Reading location…' : 'Save current location'}
          onPress={() => void captureLocation('save')}
          testID="gym-editor-location-save"
          variant="outline"
        />
      </View>
    );
  }

  return (
    <View style={styles.editor} testID="gym-editor">
      <ListRow
        accessibilityLabel={`Close editor for ${label}`}
        density="list"
        divider={false}
        expanded
        label={gym ? gym.name : 'New gym'}
        onPress={onCancel}
        testID="gym-editor-close"
        trailing={<Icon color={uiRoles.inkMuted} name="chevron-up" />}
      />
      <FormField
        accessibilityLabel="Gym name"
        autoFocus={gym === null}
        face="text"
        label="Name"
        onChangeText={setName}
        placeholder="Gym name"
        returnKeyType="done"
        testID="gym-editor-name"
        value={name}
      />

      <FormSection title="Location">
        <ListRow density="list" divider={false} leading={<Icon color={hasLocation ? uiRoles.ink : uiRoles.inkGhost} name="location" size="sm" />}>
          <Text allowFontScaling={false} style={uiText.bodyStrong} testID="gym-editor-location-status">
            {hasLocation ? (gym ? 'Location saved' : 'Location ready') : 'No location saved'}
          </Text>
        </ListRow>
      </FormSection>
      {feedback?.tone === 'error' ? <FormError message={feedback.message} testID="gym-editor-feedback" /> : null}
      {feedback?.tone === 'success' ? (
        <Text
          allowFontScaling={false}
          accessibilityLiveRegion="polite"
          style={[uiText.meta, uiTextTone.muted]}
          testID="gym-editor-feedback">
          {feedback.message}
        </Text>
      ) : null}
      {locationActions}

      <View style={styles.save}>
        <ActionButton
          disabled={isBusy || !trimmedName}
          label={gym ? 'Save' : 'Add gym'}
          onPress={() => void save()}
          testID="gym-editor-save"
          variant="primary"
        />
      </View>

      {gym ? (
        <View style={styles.destructive}>
          <ActionButton
            accessibilityLabel={`${gym.archived ? 'Unarchive' : 'Archive'} ${label}`}
            disabled={isBusy}
            label={gym.archived ? 'Unarchive' : 'Archive'}
            onPress={() => void toggleArchived()}
            testID={gym.archived ? 'gym-editor-unarchive' : 'gym-editor-archive'}
            tone={gym.archived ? 'default' : 'danger'}
            variant="text"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The row being edited: `accent-wash` with an `accent` leading rule, like the
  // exercise page's logger.
  editor: {
    gap: uiSpace.sm,
    paddingVertical: uiSpace.md,
    paddingLeft: uiSpace.sm,
    paddingRight: uiSpace.md,
    backgroundColor: uiRoles.accentWash,
    borderLeftWidth: uiSpace.xs,
    borderLeftColor: uiRoles.accent,
  },
  confirm: {
    gap: uiSpace.sm,
  },
  save: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  // Archive sits alone at the end, below the save (`ux-rules.md` "Forms" F3).
  destructive: {
    alignItems: 'flex-start',
    paddingTop: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
});
