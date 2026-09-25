import { Notice } from '@/components/ui';
import { formatOfflineMarker } from '@/src/groups';

/**
 * Contract §7 offline marker (08 pattern 7): a neutral `Notice` with the
 * `offline` glyph, announced when it appears. Cached data stays visible below it.
 */
export function GroupOfflineBanner({ lastUpdatedAtMs }: { lastUpdatedAtMs: number | null }) {
  return <Notice icon="offline" live message={formatOfflineMarker(lastUpdatedAtMs)} testID="groups-offline-banner" />;
}
