import { useLocalSearchParams } from 'expo-router';

import { CombinedMuscleEditorPage } from '@/components/preferences/combined-muscle-editor';

export default function CombinedMuscleRoute() {
  const { key, family, member } = useLocalSearchParams<{ key?: string; family?: string; member?: string }>();
  return <CombinedMuscleEditorPage combinedKey={key ?? null} family={family ?? null} memberId={member ?? null} />;
}
