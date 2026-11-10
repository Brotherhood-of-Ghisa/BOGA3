import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemeCustomScreen } from '@/components/appearance/theme-custom-screen';
import { CUSTOM_PARTS, type CustomPart } from '@/components/ui/theme-custom';

// Settings → Appearance → Custom → one part (`components/appearance/`). An
// unknown part opens the background's picker. Switching part from the title
// replaces the param, so back still returns to Appearance.
export default function ThemeCustomRoute() {
  const { part } = useLocalSearchParams<{ part?: string }>();
  const router = useRouter();
  const chosen: CustomPart = CUSTOM_PARTS.find((known) => known === part) ?? 'background';
  return <ThemeCustomScreen key={chosen} onChoosePart={(next) => router.setParams({ part: next })} part={chosen} />;
}
