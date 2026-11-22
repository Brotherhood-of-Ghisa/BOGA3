import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { StatePanel } from '@/components/ui';

// A local read settles within a few frames: the switcher's in-place swap draws
// the next exercise about 100 ms after the tap. A spinner shown for those frames
// only flickers, so it waits until a load has taken noticeably long.
export const EXERCISE_PAGE_LOADING_DELAY_MS = 300;

export function ExercisePageLoading() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), EXERCISE_PAGE_LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return shown ? (
    <StatePanel kind="loading" testID="exercise-page-state" title="Loading…" />
  ) : (
    <View accessibilityLabel="Loading…" style={{ flex: 1 }} testID="exercise-page-state-pending" />
  );
}
