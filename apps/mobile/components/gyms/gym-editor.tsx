import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
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

import { GymButton } from './gym-buttons';

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
  onCancel: () => void;
  // Injected by tests; the native reader by default.
  readPosition?: ReadForegroundPosition;
};

/**
 * One gym's editor, open in place of its row on the Gyms screen (lifted from
 * the recorder's gym modal). The name saves with Save; the private location
 * saves at once from the current position, and replacing or clearing one asks
 * first. Archive is the synced soft delete.
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
        <Text style={styles.confirmText}>
          {pending === 'replace'
            ? 'Replace the saved location with where you are now?'
            : "Clear the saved location? This gym won't be suggested nearby."}
        </Text>
        <View style={styles.buttonRow}>
          <GymButton
            accessibilityLabel={`Cancel location change for ${label}`}
            label="Cancel"
            onPress={() => setPending(null)}
            testID="gym-editor-location-cancel"
            variant="outline"
          />
          <GymButton
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
        <GymButton
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
        <GymButton
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
        <GymButton
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
      <Text style={styles.microLabel}>Name</Text>
      <TextInput
        accessibilityLabel="Gym name"
        autoFocus={gym === null}
        onChangeText={setName}
        placeholder="Gym name"
        placeholderTextColor={uiRoles.inkFaint}
        returnKeyType="done"
        style={styles.input}
        testID="gym-editor-name"
        value={name}
      />

      <Text style={styles.microLabel}>Location</Text>
      <View style={styles.status}>
        <Icon color={hasLocation ? uiRoles.ink : uiRoles.disabled} name="location" size="sm" />
        <Text style={styles.statusText} testID="gym-editor-location-status">
          {hasLocation ? (gym ? 'Location saved' : 'Location ready') : 'No location saved'}
        </Text>
      </View>
      <Text style={styles.hint}>
        Private to you. A saved location lets the gym sheet suggest this gym when you are here.
      </Text>
      {feedback ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.feedback, feedback.tone === 'error' ? styles.feedbackError : null]}
          testID="gym-editor-feedback">
          {feedback.message}
        </Text>
      ) : null}
      {locationActions}

      <View style={styles.footer}>
        {gym ? (
          <GymButton
            accessibilityLabel={`${gym.archived ? 'Unarchive' : 'Archive'} ${label}`}
            disabled={isBusy}
            label={gym.archived ? 'Unarchive' : 'Archive'}
            onPress={() => void toggleArchived()}
            testID={gym.archived ? 'gym-editor-unarchive' : 'gym-editor-archive'}
            tone={gym.archived ? 'default' : 'danger'}
            variant="text"
          />
        ) : null}
        <View style={styles.footerEnd}>
          <GymButton label="Cancel" onPress={onCancel} testID="gym-editor-cancel" variant="text" />
          <GymButton
            disabled={isBusy || !trimmedName}
            label={gym ? 'Save' : 'Add gym'}
            onPress={() => void save()}
            testID="gym-editor-save"
            variant="primary"
          />
        </View>
      </View>
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
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  input: {
    height: uiGeometry.fieldHeight,
    paddingHorizontal: uiSpace.sm,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    color: uiRoles.ink,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  statusText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  hint: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  feedback: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  feedbackError: {
    color: uiRoles.danger,
  },
  confirm: {
    gap: uiSpace.sm,
  },
  confirmText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  footerEnd: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
});
