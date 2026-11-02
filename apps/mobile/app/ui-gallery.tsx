import { useLocalSearchParams } from 'expo-router';
import { CompactGallery } from '@/components/pattern-gallery/compact-gallery';
import { isUiGalleryAllowed } from '@/src/utils/isUiGalleryAllowed';

/** Explicit deep link only; the root navigator applies the same development guard. */
export default function UiGalleryRoute() {
  const { sample, state, long, review } = useLocalSearchParams<{ sample?: string; state?: string; long?: string; review?: string }>();
  if (!isUiGalleryAllowed()) return null;
  return <CompactGallery key={`${sample}-${state}-${long}-${review}`} initialSample={sample} initialState={state}
    initialLong={long === '1'} review={review === '1'} />;
}
