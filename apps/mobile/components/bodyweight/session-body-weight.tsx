import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { ActionButton, Card, ListRow, Notice, Stat } from '@/components/ui';
import { saveBodyWeightReading } from '@/src/data/bodyweight';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import { isValidSessionWeight, sessionWeightSourceLabel, type SessionWeightSnapshot } from '@/src/bodyweight/weight-entry';
import { WeightEntrySheet } from './weight-entry-sheet';
import { weightStyles as styles } from './styles';

export function SessionBodyWeight({ sessionId, snapshot, editable = true, onSaved }: {
  sessionId: string;
  snapshot: Partial<SessionWeightSnapshot>;
  editable?: boolean;
  onSaved: (snapshot: SessionWeightSnapshot) => void;
}) {
  const router = useRouter();
  const [entryDate, setEntryDate] = useState<Date | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isValidSessionWeight(snapshot);
  const displayWeight = valid ? String(Number(snapshot.bodyWeightKg!.toFixed(3))) : 'Unavailable';
  const source = sessionWeightSourceLabel(snapshot);
  const addReading = async () => {
    setError(null);
    try {
      const session = await loadSessionSnapshotById(sessionId);
      if (!session || session.deletedAt) throw new Error('This session is no longer available.');
      setEntryDate(session.startedAt); setEditing(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open dated entry.'); }
  };
  return <>
    <Card>
      <ListRow density="list" divider={false}
        accessibilityLabel={`Session body weight, ${valid ? `${displayWeight} kg` : 'unavailable'}, ${source}`}
        testID="session-body-weight">
        <Stat label="Body weight · kg" value={displayWeight}
          kind={valid ? 'figure' : 'text'} rank="secondary" testID="session-body-weight-value" />
        <Text allowFontScaling={false} style={styles.body} testID="session-body-weight-source">{source}</Text>
      </ListRow>
      {!valid && editable ? <ActionButton variant="text"
        label={snapshot.bodyWeightMeasurementId ? 'Review weight history' : 'Add dated reading'}
        testID="session-body-weight-add-reading"
        onPress={() => snapshot.bodyWeightMeasurementId ? router.push('/body-weight') : void addReading()} /> : null}
      {error ? <Notice live tone="danger" message={error} /> : null}
    </Card>
    {entryDate ? <WeightEntrySheet visible={editing} title="Add dated reading"
      measuredAt={entryDate} initial={{ weightValue: '', weightUnit: 'kg' }}
      explanation="This dated reading recalculates affected sessions and group comparisons, up to the next reading. It may change weight-dependent certifications."
      onDismiss={() => setEditing(false)} onSave={async input => {
        await saveBodyWeightReading(input);
        const session = await loadSessionSnapshotById(sessionId);
        if (session) onSaved({ bodyWeightKg: session.bodyWeightKg ?? null,
          bodyWeightSource: session.bodyWeightSource ?? null, bodyWeightMeasurementId: session.bodyWeightMeasurementId ?? null,
          bodyWeightMeasuredAt: session.bodyWeightMeasuredAt ?? null });
      }} /> : null}
  </>;
}
