import { useState } from 'react';
import { Card, Icon, ListRow, Stat, uiRoles } from '@/components/ui';
import { Text } from 'react-native';
import { correctSessionBodyWeight } from '@/src/data/bodyweight';
import { isValidSessionWeight, sessionWeightSourceLabel, type SessionWeightSnapshot } from '@/src/bodyweight/weight-entry';
import { WeightEntrySheet } from './weight-entry-sheet';
import { weightStyles as styles } from './styles';

export function SessionBodyWeight({ sessionId, snapshot, metadataKnown = true, editable = true, onSaved }: {
  sessionId: string;
  snapshot: Partial<SessionWeightSnapshot>;
  metadataKnown?: boolean;
  editable?: boolean;
  onSaved: (snapshot: SessionWeightSnapshot) => void;
}) {
  const [editing, setEditing] = useState(false);
  const valid = metadataKnown && isValidSessionWeight(snapshot);
  const displayWeight = valid ? String(Number(snapshot.bodyWeightKg!.toFixed(3))) : 'Unknown';
  const source = !metadataKnown ? 'Session weight unavailable.' : sessionWeightSourceLabel(snapshot);
  return <>
    <Card>
      <ListRow density="list" divider={false} onPress={editable ? () => setEditing(true) : undefined}
        accessibilityLabel={`Session body weight, ${valid ? `${displayWeight} kg` : 'unknown'}, ${source}`}
        accessibilityHint={editable ? 'Opens correction for this session only' : undefined}
        testID="session-body-weight" trailing={editable ? <Icon name="chevron-right" size="sm" color={uiRoles.inkFaint} /> : undefined}>
        <Stat label="Body weight · kg" value={displayWeight}
          kind={valid ? 'figure' : 'text'} rank="secondary" testID="session-body-weight-value" />
        <Text allowFontScaling={false} style={styles.body} testID="session-body-weight-source">{source}</Text>
      </ListRow>
    </Card>
    <WeightEntrySheet visible={editing} title="Session body weight"
      initial={{ weightValue: valid ? String(snapshot.bodyWeightKg) : '', weightUnit: 'kg' }}
      explanation="Changes this session only. Bodyweight load, personal records and group scores may change; weight-dependent certifications may need review. Your Settings readings stay unchanged."
      onDismiss={() => setEditing(false)} onSave={async input => {
        const saved = await correctSessionBodyWeight(sessionId, input);
        onSaved(saved);
      }} />
  </>;
}
