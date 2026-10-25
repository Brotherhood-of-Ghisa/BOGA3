import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  ListRow,
  uiBorder,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
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
      <Text allowFontScaling={false} style={styles.cardLabel}>Backups</Text>
      <ListRow
        density="list"
        divider={false}
        meta={
          <Text allowFontScaling={false} style={styles.value} testID="settings-backup-last">
            {newest ? formatLocalDateTime(newest.takenAtMs, dateFormat) : 'Never'}
          </Text>
        }
        testID="settings-backup-last-row">
        <Text allowFontScaling={false} style={styles.label}>Last backup</Text>
      </ListRow>
      <ListRow
        density="list"
        meta={
          <Text allowFontScaling={false} style={styles.value} testID="settings-backup-count">
            {snapshots === null ? 'Unavailable' : String(snapshots.length)}
          </Text>
        }
        testID="settings-backup-count-row">
        <Text allowFontScaling={false} style={styles.label}>Saved backups</Text>
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
            style={styles.error}
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
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  label: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
    textAlign: 'right',
  },
  actions: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
    alignItems: 'flex-start',
  },
  error: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.danger,
  },
});
