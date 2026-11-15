import { useLocalSearchParams } from 'expo-router';

import { MuscleChoicePage } from '@/components/preferences/muscle-choice-settings';

export default function MuscleRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <MuscleChoicePage muscleId={id ?? ''} />;
}
