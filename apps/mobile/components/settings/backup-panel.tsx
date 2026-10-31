import { useCallback, useEffect, useState } from 'react';

import { ActionRow, FormSection, Notice, ValueRow } from '@/components/ui';
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

/** Data & sync's Backups section: the newest snapshot, how many are kept, Export. */
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
    <>
      <FormSection testID="settings-backup-card" title="Backups">
        <ValueRow
          label="Last backup"
          testID="settings-backup-last-row"
          value={newest ? formatLocalDateTime(newest.takenAtMs, dateFormat) : 'Never'}
          valueTestID="settings-backup-last"
        />
        <ValueRow
          divider
          label="Saved backups"
          testID="settings-backup-count-row"
          value={snapshots === null ? 'Unavailable' : String(snapshots.length)}
          valueTestID="settings-backup-count"
        />
        <ActionRow
          divider
          disabled={exporting}
          kind="act"
          label={exporting ? 'Exporting…' : 'Export database'}
          onPress={() => {
            void handleExport();
          }}
          testID="settings-backup-export-button"
        />
      </FormSection>
      {error ? <Notice icon="warning" live message={error} testID="settings-backup-error" tone="danger" /> : null}
    </>
  );
}
