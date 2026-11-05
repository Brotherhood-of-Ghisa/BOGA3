import { Stack, useLocalSearchParams } from 'expo-router';

import { CUSTOM_PART_LABELS } from '@/components/appearance/chosen-theme';
import { ThemeCustomScreen } from '@/components/appearance/theme-custom-screen';
import { CUSTOM_PARTS, type CustomPart } from '@/components/ui/theme-custom';

// Settings → Appearance → Custom → one part (`components/appearance/`). An
// unknown part opens the background's picker.
export default function ThemeCustomRoute() {
  const { part } = useLocalSearchParams<{ part?: string }>();
  const chosen: CustomPart = CUSTOM_PARTS.find((known) => known === part) ?? 'background';
  return (
    <>
      <Stack.Screen options={{ title: CUSTOM_PART_LABELS[chosen] }} />
      <ThemeCustomScreen key={chosen} part={chosen} />
    </>
  );
}
