import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { ScreenScroll } from '@/components/ui/screen';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ReadForegroundPosition } from '@/src/location/gym-location-reads';
import { gymHasSavedLocation, listGymDirectory, type GymDirectoryEntry } from '@/src/session-recorder/gym-options';

import { GymEditor } from './gym-editor';

// The open editor: a gym's id, or `new` for the add row.
type EditorTarget = string | 'new' | null;

type DirectoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; gyms: GymDirectoryEntry[] };

export type GymsScreenProps = {
  // Injected by tests; the native reader by default.
  readPosition?: ReadForegroundPosition;
};

/**
 * The Gyms screen (`/gyms`): every gym with whether it has a saved location,
 * `+ Add gym`, and archived gyms behind `Show archived`. A row opens its
 * editor in place. Reached from the session view's gym sheet (`Manage gyms`)
 * and from More → Tools (`source=more`, with `Back to More`).
 */
export function GymsScreen({ readPosition }: GymsScreenProps) {
  const [directory, setDirectory] = useState<DirectoryState>({ status: 'loading' });
  const [editing, setEditing] = useState<EditorTarget>(null);
  const [showArchived, setShowArchived] = useState(false);
  const loadGenerationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    try {
      const gyms = await listGymDirectory();
      if (generation === loadGenerationRef.current) setDirectory({ status: 'ready', gyms });
    } catch {
      if (generation === loadGenerationRef.current) setDirectory({ status: 'error' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const closeEditor = () => {
    setEditing(null);
    void reload();
  };

  const gymRow = (gym: GymDirectoryEntry, index: number): ReactNode => {
    if (editing === gym.id) {
      return (
        <GymEditor
          gym={gym}
          key={gym.id}
          onCancel={() => setEditing(null)}
          onDone={closeEditor}
          onLocationChanged={() => void reload()}
          readPosition={readPosition}
        />
      );
    }
    const located = gymHasSavedLocation(gym);
    return (
      <ListRow
        accessibilityLabel={`Edit gym ${gym.name}`}
        density="list"
        divider={index > 0}
        key={gym.id}
        leading={<Icon color={located ? uiRoles.ink : uiRoles.disabled} name="location" size="sm" />}
        onPress={() => setEditing(gym.id)}
        testID={`gyms-row-${gym.id}`}
        trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" />}>
        <Text numberOfLines={1} style={styles.rowName}>
          {gym.name}
        </Text>
        <Text style={styles.rowDetail} testID={`gyms-row-${gym.id}-status`}>
          {gym.archived ? 'Archived' : located ? 'Location saved' : 'No location saved'}
        </Text>
      </ListRow>
    );
  };

  let body: ReactNode;
  if (directory.status === 'loading') {
    body = (
      <View style={styles.state} testID="gyms-loading">
        <ActivityIndicator color={uiRoles.inkMuted} />
      </View>
    );
  } else if (directory.status === 'error') {
    body = (
      <View style={styles.state} testID="gyms-error">
        <Text style={styles.stateText}>{"Couldn't load your gyms."}</Text>
        <ActionButton label="Retry" onPress={() => void reload()} testID="gyms-retry" variant="outline" />
      </View>
    );
  } else {
    const active = directory.gyms.filter((gym) => !gym.archived);
    const archived = directory.gyms.filter((gym) => gym.archived);
    body = (
      <>
        <Card testID="gyms-list">
          {active.length === 0 && editing !== 'new' ? (
            <Text style={styles.empty}>No gyms yet.</Text>
          ) : null}
          {active.map(gymRow)}
          {editing === 'new' ? (
            <GymEditor
              gym={null}
              onCancel={() => setEditing(null)}
              onDone={closeEditor}
              onLocationChanged={() => void reload()}
              readPosition={readPosition}
            />
          ) : null}
        </Card>
        {editing !== 'new' ? (
          <ActionButton label="+ Add gym" onPress={() => setEditing('new')} testID="gyms-add" variant="outline" />
        ) : null}
        {archived.length > 0 ? (
          <ActionButton
            label={showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            onPress={() => setShowArchived((current) => !current)}
            testID="gyms-toggle-archived"
            variant="text"
          />
        ) : null}
        {showArchived && archived.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.microLabel}>Archived</Text>
            <Card testID="gyms-archived-list">{archived.map(gymRow)}</Card>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <ScreenScroll
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      testID="gyms-screen">
      <MoreHubBackButton returnBy="dismiss" />
      {body}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  rowName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  rowDetail: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  empty: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  section: {
    gap: uiSpace.sm,
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
  state: {
    alignItems: 'center',
    gap: uiSpace.md,
    paddingVertical: uiSpace.xl,
  },
  stateText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.inkMuted,
  },
});
