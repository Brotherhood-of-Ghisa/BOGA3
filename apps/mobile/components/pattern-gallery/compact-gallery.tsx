import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, CompactCard, Notice, ScreenScroll, SegmentedControl, SwitchRow, ToggleChip, uiSpace, uiText } from '@/components/ui';
import { CoWPreview, CoWResultHeading } from '@/components/groups/cow-preview';
import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import { GroupStreamSessionCard } from '@/components/groups/stream-session-card';
import { TodayCoWSummarySection } from '@/components/today/group-cow-summary';
import { GroupApiError } from '@/src/groups/api';
import type { GroupResourceState } from '@/src/groups/use-group-resource';
import type { CoWResultWire, CoWSummaryWire } from '@/src/groups/cow-wire';
import { SummaryGallery } from './summary-gallery';
import { cowSummary, competitionEvent, galleryCow, gallerySession, GALLERY_SAMPLES, GALLERY_STATES, COW_GALLERY_STATES,
  type GallerySample, type GalleryState } from './fixtures';

type GalleryProps = { initialSample?: string; initialState?: string; initialLong?: boolean; review?: boolean };

/** A gallery of the real presenters; callbacks report their action without writes. */
export function CompactGallery({ initialSample, initialState, initialLong = false, review = false }: GalleryProps) {
  const [sample, setSample] = useState<GallerySample>(() => GALLERY_SAMPLES.find(item => item.value === initialSample)?.value ?? 'stream');
  const [selectedState, setState] = useState<GalleryState>(() => GALLERY_STATES.find(item => item.value === initialState)?.value ?? 'ready');
  const stateOptions = sample === 'cow' ? COW_GALLERY_STATES : GALLERY_STATES;
  const state = sample !== 'stream' && stateOptions.some(item => item.value === selectedState) ? selectedState : 'ready';
  const [long, setLong] = useState(initialLong);
  const [action, setAction] = useState('');
  const result = galleryCow(state, long);
  const session = { ...gallerySession,
    memberName: long ? 'Contessa Serbelloni Mazzanti Vien dal Mare' : gallerySession.memberName,
    gymName: long ? 'Iron Works · a long location with 123456 training figures' : gallerySession.gymName,
    setsLabel: long ? '123456 sets' : gallerySession.setsLabel };
  const event = long ? { ...competitionEvent,
    group_exercise: { ...competitionEvent.group_exercise, name: 'Chest supported row with a very long exercise name' },
    member: { user_id: 'other', username: session.memberName },
    values: competitionEvent.values.map(value => ({ ...value, value: 123456.7 })) } : competitionEvent;
  const resource = galleryResource(state, result);
  const retry = () => { setState('ready'); setAction('Retry'); };
  if (sample === 'summary') return <SummaryGallery initialState={initialState} initialLong={initialLong} review={review}>
    <SegmentedControl options={GALLERY_SAMPLES} value={sample} onChange={setSample} testIDPrefix="ui-gallery-sample" accessibilityLabel="Component example" />
  </SummaryGallery>;
  return <ScreenScroll testID={`ui-gallery-${sample}-${state}-${long ? 'long' : 'normal'}`} contentInsetAdjustmentBehavior="automatic">
    {!review ? <>
      <SegmentedControl options={GALLERY_SAMPLES} value={sample} onChange={setSample} testIDPrefix="ui-gallery-sample" accessibilityLabel="Component example" />
      {sample !== 'stream' ? <View style={styles.controls}>
        <ToggleChip options={stateOptions} value={state} onChange={setState} accessibilityLabel="Example state" testID="ui-gallery-state" />
      </View> : null}
      <SwitchRow label="Long content" value={long} onValueChange={setLong} testID="ui-gallery-long" />
    </> : null}
    {sample === 'stream' ? <>
      <GroupStreamSessionCard card={session} showGroupNames onPress={() => setAction('Session')} onPressRecord={key => setAction(`Record · ${key}`)} />
      <GroupStreamSessionCard card={{ ...session, key: 'completed', isTrainingNow: false, statusLabel: 'Completed · 45m', records: [] }}
        showGroupNames={false} onPress={() => setAction('Completed session')} />
      <GroupMetricStreamCard item={event} userId="me" showGroupName onPress={() => setAction('Board history')} />
      <CompactCard><CoWResultHeading result={galleryCow('ready', long)} today dateFormat="DD-MM-YYYY" /></CompactCard>
      <CompactCard><CoWResultHeading result={galleryCow('past', long)} previous today dateFormat="DD-MM-YYYY" /></CompactCard>
    </> : sample === 'cow' ? <CoWPreview result={result} userId="u1" dateFormat="DD-MM-YYYY" previous={state === 'past'}
      onOpen={metric => setAction(`CoW · ${metric}`)} onBrowse={metric => setAction(`Standings · ${metric}`)} testID="gallery-cow" />
      : <Card testID="gallery-embedded-card">
        <TodayCoWSummarySection resource={resource} previous={state === 'past'} dateFormat="DD-MM-YYYY"
          onOpen={() => setAction('Current CoW')} onRetry={retry} />
      </Card>}
    {sample === 'embedded' && state === 'absent' ? <Text allowFontScaling={false} style={uiText.meta} testID="gallery-absent">No CoW summary</Text> : null}
    {action ? <Notice live message={action} testID="ui-gallery-action" /> : null}
  </ScreenScroll>;
}

function galleryResource(state: GalleryState, result: CoWResultWire): GroupResourceState<CoWSummaryWire> {
  return {
    data: state === 'loading' || state === 'error' ? null : { ...cowSummary(), result: state === 'absent' ? null : result,
      selection: state === 'absent' ? 'none' : state === 'past' ? 'previous' : 'current' },
    lastUpdatedAtMs: new Date(2026, 9, 30, 12).getTime(), hydrated: true, refreshing: false, offline: state === 'offline',
    error: state === 'error' ? new GroupApiError('INTERNAL', 'Please try again.') : null,
    lostAccess: false, refresh: async () => {},
  };
}

const styles = StyleSheet.create({ controls: { flexDirection: 'row', gap: uiSpace.sm } });
