import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Icon, ListRow, uiRoles } from '@/components/ui';
import { readCurrentBodyWeight } from '@/src/data/bodyweight';
import { isValidBodyWeightReading } from '@/src/bodyweight/weight-entry';
import { BODY_WEIGHT_ROUTE } from '@/src/navigation/routes';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';

export function BodyWeightSettingsRow() {
  const router = useRouter();
  const [description, setDescription] = useState('Loading weight…');
  useFocusEffect(useCallback(() => {
    let active = true;
    void readCurrentBodyWeight().then(reading => {
      if (active) setDescription(!reading ? 'No weight recorded' : isValidBodyWeightReading(reading)
        ? `${reading.weightValue} ${reading.weightUnit} · ${formatCurrentDateTime(reading.measuredAt)}`
        : 'Reading needs review');
    }).catch(() => { if (active) setDescription('Could not load weight. Open to retry.'); });
    return () => { active = false; };
  }, []));
  return <ListRow label="Body weight" description={description} density="list" divider={false}
    accessibilityLabel={`Body weight, ${description}`} accessibilityHint="Opens weight entry and history"
    onPress={() => router.push(BODY_WEIGHT_ROUTE)} testID="settings-body-weight-row"
    leading={<Icon name="user" size="md" color={uiRoles.inkMuted} />}
    trailing={<Icon name="chevron-right" size="sm" color={uiRoles.inkFaint} />} />;
}
