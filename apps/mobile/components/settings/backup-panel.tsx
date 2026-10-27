import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  FigureText,
  ListRow,
  uiBorder,
  uiRoles,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { getDatabaseBackups, type DatabaseBackups } from '@/src/backup/database-backups';
import type { Snapshot } from '@/src/backup/snapshots';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';

type BackupPanelProps = {
  /** Override the device backups in tests. */
  backups?: DatabaseBackups;
};

const readSnapshots = (backups: DatabaseBackups): Snapshot[] | null => {
  try {
    return backups.list();
  } catch {
    return null;
  }
};

/** Data & sync's Backups card: the newest snapshot, how many are kept, Export. */
export function BackupPanel({ backups = getDatabaseBackups() }: BackupPanelProps) {
  const dateFormat = useDateFormat();
  const [snapshots, setSnapshots] = useState(() => readSnapshots(backups));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => backups.subscribe(() => setSnapshots(readSnapshots(backups))), [backups]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      await backups.exportDatabase();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [backups]);

  const newest = snapshots?.[0];
  return (
    <Card testID="settings-backup-card">
      <Text allowFontScaling={false} style={[uiText.label, styles.cardLabel]}>Backups</Text>
      <ListRow
        density="list"
        divider={false}
        meta={
          <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink, styles.value]} testID="settings-backup-last">
            <FigureText>{newest ? formatLocalDateTime(newest.takenAtMs, dateFormat) : 'Never'}</FigureText>
          </Text>
        }
        testID="settings-backup-last-row">
        <Text allowFontScaling={false} style={uiText.body}>Last backup</Text>
      </ListRow>
      <ListRow
        density="list"
        meta={
          <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink, styles.value]} testID="settings-backup-count">
            <FigureText>{snapshots === null ? 'Unavailable' : String(snapshots.length)}</FigureText>
          </Text>
        }
        testID="settings-backup-count-row">
        <Text allowFontScaling={false} style={uiText.body}>Saved backups</Text>
      </ListRow>
      <View style={styles.actions}>
        <ActionButton
          accessibilityLabel={exporting ? 'Exporting database…' : 'Export database'}
          disabled={exporting}
          label={exporting ? 'Exporting…' : 'Export database'}
          onPress={() => {
            void handleExport();
          }}
          testID="settings-backup-export-button"
          variant="outline"
        />
        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            allowFontScaling={false}
            style={[uiText.meta, uiTextTone.danger]}
            testID="settings-backup-error">
            {error}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardLabel: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.xs,
  },
  value: {
    textAlign: 'right',
  },
  actions: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
    alignItems: 'flex-start',
  },
});
