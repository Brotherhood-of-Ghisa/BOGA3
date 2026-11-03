import { useLocalSearchParams } from 'expo-router';
import { CompactGallery } from '@/components/pattern-gallery/compact-gallery';
import { TableGallery } from '@/components/pattern-gallery/table-gallery';
import { SummaryGallery } from '@/components/pattern-gallery/summary-gallery';
import { ListGallery } from '@/components/pattern-gallery/list-gallery';
import { isUiGalleryAllowed } from '@/src/utils/isUiGalleryAllowed';

/** Explicit deep link only; the root navigator applies the same development guard. */
export default function UiGalleryRoute() {
  const { family, sample, state, long, review } = useLocalSearchParams<{ family?: string; sample?: string; state?: string; long?: string; review?: string }>();
  if (!isUiGalleryAllowed()) return null;
  if (family === 'summary') return <SummaryGallery key={`${state}-${long}-${review}`} initialState={state}
    initialLong={long === '1'} review={review === '1'} />;
  if (family === 'table') return <TableGallery key={`${sample}-${state}-${long}-${review}`} initialSample={sample} initialState={state}
    initialLong={long === '1'} review={review === '1'} />;
  if (family === 'list') return <ListGallery key={`${sample}-${state}-${long}-${review}`} initialSample={sample} initialState={state}
    initialLong={long === '1'} review={review === '1'} />;
  return <CompactGallery key={`${sample}-${state}-${long}-${review}`} initialSample={sample} initialState={state}
    initialLong={long === '1'} review={review === '1'} />;
}
