import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Notice, ScreenScroll, SegmentedControl, SwitchRow, ToggleChip, uiSpace } from '@/components/ui';
import { GroupHomeBoard } from '@/components/groups/group-home-board';
import { GroupGlancePage } from '@/components/groups/group-glance-page';
import { TodayGroupHeader } from '@/components/today/group-header';
import { TodayWeekBoardCard } from '@/components/today/today-week-board';
import { TodayCoWSummarySection } from '@/components/today/group-cow-summary';
import { buildGroupHomeBoard } from '@/src/groups/home-view-model';
import type { GroupHomeMetric } from '@/src/groups/home-periods';
import { GroupApiError } from '@/src/groups/api';
import { LIST_GALLERY_NOW, LIST_GALLERY_STATES, listGalleryMembers, listGallerySeries, listGalleryWeekBoard,
  type ListGalleryState } from './list-fixtures';
import { CompactRowComparison } from './compact-row-fixtures';
import { cowSummary } from './fixtures';

const SAMPLES = [{ value: 'boards', label: 'Boards' }, { value: 'glance', label: 'At a glance' },
  { value: 'rows', label: 'Rows' }, { value: 'actions', label: 'Actions' }] as const;
type ListSample = typeof SAMPLES[number]['value'];

/** Native fixtures use the same board presenters and page as the production references. */
export function ListGallery({ initialSample, initialState, initialLong = false, review = false }: {
  initialSample?: string; initialState?: string; initialLong?: boolean; review?: boolean;
}) {
  const viewport = useWindowDimensions();
  useEffect(() => { console.info('LIST_GALLERY_VIEWPORT', JSON.stringify(viewport)); }, [viewport]);
  const [sample, setSample] = useState<ListSample>(() => SAMPLES.find(item => item.value === initialSample)?.value ?? 'boards');
  const [state, setState] = useState<ListGalleryState>(() => LIST_GALLERY_STATES.find(item => item.value === initialState)?.value ?? 'ready');
  const [long, setLong] = useState(initialLong);
  const [action, setAction] = useState('');
  const [group, setGroup] = useState('g1');
  const [metric, setMetric] = useState<GroupHomeMetric>('sets');
  const [offset, setOffset] = useState(0);
  const groups = [{ groupId: 'g1', name: 'Iron Wednesdays' }, { groupId: 'g2', name: 'Lunch Club' }];
  const board = buildGroupHomeBoard({ members: listGalleryMembers(state, long), metric, myUserId: 'me' });
  return <ScreenScroll testID={`ui-gallery-list-${sample}-${state}-${long ? 'long' : 'normal'}`} contentInsetAdjustmentBehavior="automatic">
    {!review ? <>
      <SegmentedControl options={SAMPLES} value={sample} onChange={setSample} accessibilityLabel="List example" testIDPrefix="list-gallery-sample" />
      <View style={styles.controls}><ToggleChip options={LIST_GALLERY_STATES} value={state} onChange={setState}
        accessibilityLabel="Example state" testID="list-gallery-state" /></View>
      <SwitchRow label="Long content" value={long} onValueChange={setLong} testID="list-gallery-long" />
    </> : null}
    {sample === 'rows' ? <CompactRowComparison onAction={setAction} />
    : sample === 'glance' || ['loading', 'error', 'offline'].includes(state) ? <View style={styles.reference}>
      <GroupGlancePage myUserId="me" now={LIST_GALLERY_NOW} metric={metric} onMetricChange={setMetric} period="week"
        offset={offset} onOffsetChange={setOffset} series={state === 'loading' || state === 'error' || state === 'offline' ? null : listGallerySeries(state, long)}
        error={state === 'error' ? new GroupApiError('INTERNAL', 'Please try again.') : null} offline={state === 'offline'}
        onRetry={() => { setState('ready'); setAction('Retry'); }} />
    </View> : <>
      <GroupHomeBoard board={board} metric={metric} title="Top brothers" />
      <TodayWeekBoardCard board={listGalleryWeekBoard(state, long)} range="26 Oct – 1 Nov 26" accessibilityRange="26-10-2026 – 01-11-2026"
        challenges={sample === 'actions' ? <TodayCoWSummarySection resource={{ data: cowSummary(), lastUpdatedAtMs: LIST_GALLERY_NOW.getTime(),
          hydrated: true, refreshing: false, offline: false, error: null, lostAccess: false, refresh: async () => {} }}
          previous={false} dateFormat="DD-MM-YYYY" onOpen={() => setAction('Current CoW')} onRetry={() => setAction('CoW Retry')} /> : null}
        onOpenGroup={() => setAction(`Board · ${group}`)} header={<TodayGroupHeader
          groupName={groups.find(item => item.groupId === group)!.name} groups={groups} selectedGroupId={group}
          onSelectGroup={id => { setGroup(id); setAction(`Group · ${id}`); }} onOpenHome={() => setAction(`Group home · ${group}`)} />} />
    </>}
    {action ? <Notice live message={action} testID="list-gallery-action" /> : null}
  </ScreenScroll>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: uiSpace.sm },
  reference: { height: 700 },
});
