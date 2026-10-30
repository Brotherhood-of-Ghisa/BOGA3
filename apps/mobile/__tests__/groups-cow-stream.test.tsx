import { fireEvent, render, screen } from '@testing-library/react-native';
import { CoWStreamCard } from '@/components/groups/cow-stream-card';
import { isCompetitionStreamWire } from '@/src/groups/competition-reader-guards';
import { isCoWStreamItemWire } from '@/src/groups/cow-stream-wire';
import { buildCoWStreamCard } from '@/src/groups/cow-stream-view-model';
import { buildCompetitionStreamModels } from '@/src/groups/competition-stream-view-model';
import type { CoWStreamEvent, CompetitionStreamWire } from '@/src/groups/competition-wire';
import { compareStreamOrder, mergeStreamPages } from '@/src/groups/use-group-stream';
import { groupCacheKeys, readGroupCache, writeGroupCache, observeGroupCompetitionPolicy } from '@/src/groups/cache';
import { cowStreamItem } from './helpers/cow-fixtures';
import { competitionSession } from './helpers/competition-fixtures';
import { createInMemoryDatabase } from './helpers/in-memory-db';

const mockPush=jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
const events: CoWStreamEvent[]=['scheduled','updated','cancelled','started','ended','results','unavailable'];
const stream=(event: CoWStreamEvent = 'scheduled'): CompetitionStreamWire => ({ contract_version: 4,items: [cowStreamItem(event)],has_more: false,next_cursor: null });

it.each(events)('accepts the closed %s projection and renders one default-visible card', event => {
  const item=cowStreamItem(event);
  expect(isCoWStreamItemWire(item)).toBe(true);
  expect(isCompetitionStreamWire(stream(event))).toBe(true);
  expect(buildCompetitionStreamModels([item],undefined,'DD-MM-YYYY')).toEqual([item]);
  render(<CoWStreamCard item={item} userId="u1" />);
  const card=screen.getByTestId(`cow-stream-${item.key}`);
  expect(card).toHaveTextContent('Bench press',{ exact: false });
  expect(card).toHaveTextContent('Europe/London',{ exact: false });
  fireEvent.press(card);
  expect(mockPush).toHaveBeenLastCalledWith('/group/g1/cows/cow1');
});

it.each([
  { secret: 80 }, { key: 1 }, { key: '1' }, { sort_at_ms: Infinity }, { event: 'joined' },
  { actor: { user_id: 'u1',username: 'Me',body_weight_kg: 80 } }, { previous: {} }, { result: {} },
])('rejects unsafe or malformed event fields %j', patch => {
  expect(isCoWStreamItemWire({ ...cowStreamItem(),...patch })).toBe(false);
});

it('rejects private definitions and incoherent edit/final identities', () => {
  const item=cowStreamItem('updated');
  expect(isCoWStreamItemWire({ ...item,definition: { ...item.definition,reading: 80 } })).toBe(false);
  expect(isCoWStreamItemWire({ ...item,previous: { ...item.previous,cow_id: 'replacement' } })).toBe(false);
  expect(isCoWStreamItemWire({ ...item,previous: null })).toBe(false);
  const final=cowStreamItem('results');
  expect(isCoWStreamItemWire({ ...final,result: { ...final.result,cow: { ...final.result!.cow,state: 'active' } } })).toBe(false);
  expect(isCoWStreamItemWire({ ...final,result: { ...final.result,cow: { ...final.result!.cow,cow_id: 'replacement' } } })).toBe(false);
  expect(isCoWStreamItemWire({ ...final,result: { ...final.result,rankings: [] } })).toBe(false);
  expect(isCoWStreamItemWire({ ...final,result: { ...final.result,normalized: false } })).toBe(false);
});

it('keeps independent winners, empty metrics and suppressed original winners distinct', () => {
  const item=cowStreamItem('results');
  const model=buildCoWStreamCard(item,'u1','DD-MM-YYYY');
  expect(model.details[0]).toContain('You');
  expect(model.details[0]).toContain('150.0');
  expect(model.details[1]).toContain('No qualifying results');
  item.result!.rankings[0].entries[0]={ ...item.result!.rankings[0].entries[0],value: null,state: 'unavailable' };
  expect(isCoWStreamItemWire(item)).toBe(true);
  expect(buildCoWStreamCard(item,'u1','DD-MM-YYYY').details[0]).toContain('You · Unavailable');
  expect(buildCoWStreamCard(item,'u1','DD-MM-YYYY').details.join(' ')).not.toContain('150');
  expect(buildCoWStreamCard(cowStreamItem('unavailable'),'u1','DD-MM-YYYY').details).toEqual(['Group comparisons unavailable']);
});

it('preserves before/after exercise and metric descriptions and exact replacement identity', () => {
  const item=cowStreamItem('updated');
  item.previous!.metrics=['volume'];
  const model=buildCoWStreamCard(item,null,'DD-MM-YYYY');
  expect(model.details).toEqual(['Squat → Bench press','Volume → 1RM · Volume · Improvement']);
  const cancelled=cowStreamItem('cancelled'); cancelled.definition.cow_id='old';
  expect(buildCoWStreamCard(cancelled,null,'DD-MM-YYYY').path).toBe('/group/g1/cows/old');
});

it('orders equal-millisecond transitions by padded server sequence across refresh and pages', () => {
  const ended=cowStreamItem('ended'), result=cowStreamItem('results');
  result.key='00000000000000000010'; ended.key='00000000000000000009';
  expect(compareStreamOrder(result,ended)).toBeLessThan(0);
  const first={ ...stream(),items: [result],has_more: true,next_cursor: 'opaque' };
  expect(mergeStreamPages(first,{ items: [result,ended],cursor: null,hasMore: false })).toEqual([result,ended]);
});

it('uses the chosen date order for event time and complete spoken challenge dates', () => {
  const model=buildCoWStreamCard(cowStreamItem(),'u1','MM-DD-YYYY');
  expect(model.date).toBe('11-02-2026 00:00');
  expect(model.accessibilityLabel).toContain('10-26-2026');
  expect(model.accessibilityLabel).toContain('11-01-2026');
});

it('versions cached event payloads and isolates account/group, including foreign definitions', () => {
  const db=createInMemoryDatabase();
  try {
    const key=groupCacheKeys.stream('g1');
    writeGroupCache(db.database,{ cacheKey: key,userId: 'u1',payload: stream(),fetchedAtMs: 1 });
    expect(readGroupCache(db.database,key,'u1')?.payload).toEqual(stream());
    expect(readGroupCache(db.database,key,'u2')).toBeNull();
    expect(readGroupCache(db.database,groupCacheKeys.stream('g2'),'u1')).toBeNull();
    const foreign=stream(); (foreign.items[0] as ReturnType<typeof cowStreamItem>).definition.group_id='g2';
    expect(() => writeGroupCache(db.database,{ cacheKey: key,userId: 'u1',payload: foreign,fetchedAtMs: 1 })).toThrow('Unsafe group cache payload.');
    expect(readGroupCache(db.database,'stream:v7:g1','u1')).toBeNull();
  } finally { db.close(); }
});

it('retires an absolute cached CoW event when a newly normalized source is observed', () => {
  const db=createInMemoryDatabase();
  try {
    const item=cowStreamItem('results'); const result=item.result!;
    result.normalized=false; result.bodyweight_calculations_enabled=false;
    result.exercise={ ...result.exercise!,rules: { ...result.exercise!.rules,bodyweight_calculations_enabled: false } };
    result.rankings[0].unit='kg'; result.rankings[1].unit='kg_reps';
    const key=groupCacheKeys.stream('g1');
    writeGroupCache(db.database,{ cacheKey: key,userId: 'u1',payload: { ...stream(),items: [item] },fetchedAtMs: 1 });
    expect(readGroupCache(db.database,key,'u1')).not.toBeNull();
    observeGroupCompetitionPolicy(db.database,'g1','u1',competitionSession);
    expect(readGroupCache(db.database,key,'u1')).toBeNull();
  } finally { db.close(); }
});
