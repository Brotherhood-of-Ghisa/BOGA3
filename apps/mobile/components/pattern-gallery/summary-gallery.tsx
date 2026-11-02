import { useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Notice, Screen, SwitchRow, ToggleChip, uiSpace } from '@/components/ui';
import { GroupGlancePage } from '@/components/groups/group-glance-page';
import { GroupOfflineBanner } from '@/components/groups/offline-banner';
import { GroupApiError } from '@/src/groups/api';
import type { GroupHomeMetric } from '@/src/groups/home-periods';
import { SUMMARY_NOW, SUMMARY_STATES, summarySeries, type SummaryState } from './summary-fixtures';

type SummaryGalleryProps = { initialState?: string; initialLong?: boolean; review?: boolean; children?: ReactNode };

/** Fixed reads around the actual reference page, with its period/metric actions. */
export function SummaryGallery({ initialState, initialLong = false, review = false, children }: SummaryGalleryProps) {
  const [state, setState] = useState<SummaryState>(() => SUMMARY_STATES.find(item => item.value === initialState)?.value ?? 'ready');
  const [long, setLong] = useState(initialLong);
  const [offset, setOffset] = useState(state === 'past' ? -1 : state === 'held' ? -10 : 0);
  const [metric, setMetric] = useState<GroupHomeMetric>('sets');
  const [action, setAction] = useState('');
  const offline = state === 'offline' || state === 'offline-empty';
  return <Screen style={styles.page} testID={`ui-gallery-summary-${state}-${long ? 'long' : 'normal'}`}>
    {!review ? <>
      {children}
      <ToggleChip options={SUMMARY_STATES} value={state} onChange={next => { setState(next); setOffset(next === 'past' ? -1 : next === 'held' ? -10 : 0); }}
        accessibilityLabel="Example state" testID="ui-gallery-summary-state" />
      <SwitchRow label="Long content" value={long} onValueChange={setLong} testID="ui-gallery-summary-long" />
    </> : null}
    {offline && state !== 'offline-empty' ? <GroupOfflineBanner lastUpdatedAtMs={SUMMARY_NOW.getTime()} /> : null}
    <GroupGlancePage myUserId="me" now={SUMMARY_NOW} period="week" metric={metric} onMetricChange={setMetric}
      offset={offset} onOffsetChange={setOffset} series={summarySeries(state === 'held' ? 0 : offset, state, long)}
      held={state === 'held' ? { period: 'week', offset: 0 } : null} offline={offline}
      error={state === 'error' ? new GroupApiError('INTERNAL', 'Please try again.') : null}
      onRetry={() => { setState('ready'); setAction('Retry'); }} style={styles.reference} />
    {action ? <Notice live message={action} testID="ui-gallery-summary-action" /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: uiSpace.md, gap: uiSpace.md },
  reference: { flex: 1 },
});
