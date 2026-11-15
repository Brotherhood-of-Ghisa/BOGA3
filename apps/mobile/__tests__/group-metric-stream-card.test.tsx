import { fireEvent, render, screen } from '@testing-library/react-native';
import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import type { CompetitionEventWire } from '@/src/groups/competition-wire';
import { competitionEvent,competitionCertification } from './helpers/competition-fixtures';
const mockPush=jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
beforeEach(() => jest.clearAllMocks());
const ordinarySet={ visibility: 'ordinary' as const,session_id: 's1',session_exercise_id: 'se1',exercise_definition_id: 'd1',set_id: 'set1',
  reps: 5,performance_status: null,source_load_input_mode: 'total_load' as const,achieved_at_ms: 1,exercise_order_index: 0,set_order_index: 0,weight_value: '120' };
const renderCard=(item: CompetitionEventWire,props: Partial<Parameters<typeof GroupMetricStreamCard>[0]> = {}) => {
  render(<GroupMetricStreamCard item={item} userId="me" showGroupName={false} {...props} />);
  return screen.getByTestId(`group-metric-stream-${item.event_id}`);
};
it('shows original normalized units and the set with its one status, without raw load, bodyweight or dependency pins', () => {
  const card=renderCard(competitionEvent);
  expect(card).toHaveTextContent('1RM 45.7 %BW',{ exact: false });
  expect(screen.getByTestId('group-metric-stream-event1-set')).toHaveTextContent('5 reps');
  expect(screen.getByTestId('group-metric-stream-event1-certification')).toHaveTextContent('Not certified');
  expect(card).not.toHaveTextContent(/As logged|Uncertified/);
  expect(card.props.accessibilityLabel).toContain('1RM 45.7 %BW');
  expect(card.props.accessibilityLabel).not.toMatch(/kg|bodyweight reading|fingerprint|digest/);
  fireEvent.press(card);
  expect(mockPush).toHaveBeenCalledWith('/group/g1/leaderboards/ge1/history?metric=e1rm&scope=all');
});
it.each([
  ['e1rm','kg',120,'1RM 120.0'],['volume','kg_reps',600,'Volume 600.0'],
  ['volume','percent_bw_reps',620,'Volume 620.0 %BW'],
] as const)('keeps %s original unit %s', (metric,unit,value,line) => {
  const card=renderCard({ ...competitionEvent,metric,values: [{ ...competitionEvent.values[0],metric,unit,value }] });
  expect(card).toHaveTextContent(line,{ exact: false });
});
const withdrawal=(): CompetitionEventWire => {
  const event={ ...competitionEvent,event_id: 'w1',kind: 'record_voided' as const,sort_at_ms: Date.UTC(2026,10,11,9),
    related_event_id: 'event1',metric: null,values: [],record_context: null,reps: null };
  Object.defineProperty(event,'reason',{ get: () => { throw new Error('private cause read'); } });
  return event;
};
const withdrawnRecord={ event: { ...competitionEvent,voided: true,sort_at_ms: Date.UTC(2026,10,10,8),
  member: { user_id: 'u2',username: 'GoldmanBoyo' },
  values: [{ ...competitionEvent.values[0],unit: 'kg',value: 116 },{ ...competitionEvent.values[0],metric: 'volume' as const,unit: 'kg_reps',value: 580 }] },
  record: { performance: ordinarySet,previous: [],group_record_metrics: ['e1rm' as const] } };
it('shows a withdrawn GR as its GR card, dated at withdrawal, without a certification or the private cause', () => {
  const card=renderCard(withdrawal(),{ withdrawn: withdrawnRecord });
  expect(screen.getByTestId('group-metric-stream-w1-label')).toHaveTextContent('GoldmanBoyo · GR withdrawn');
  expect(screen.getByTestId('group-metric-stream-w1-context')).toHaveTextContent('Pull-up');
  expect(screen.getByTestId('group-metric-stream-w1-set')).toHaveTextContent('120.0 × 5');
  expect(screen.getByTestId('group-metric-stream-w1-date')).toHaveTextContent('11-11-2026');
  expect(card).toHaveTextContent('1RM 116.0',{ exact: false });
  expect(card).not.toHaveTextContent(/Volume|Certif|Score unavailable/);
  expect(screen.queryByTestId('group-metric-stream-w1-certification')).toBeNull();
  expect(card.props.accessibilityLabel).toBe('GoldmanBoyo · GR withdrawn, Pull-up, 120.0 × 5, 1RM 116.0, 11-11-2026');
  fireEvent.press(card);
  expect(mockPush).toHaveBeenCalledWith('/group/g1/leaderboards/ge1/history?metric=e1rm&scope=all');
});
it('names you on your own withdrawn GR', () => {
  renderCard(withdrawal(),{ withdrawn: { ...withdrawnRecord,event: { ...withdrawnRecord.event,member: { user_id: 'me',username: 'Me' } } } });
  expect(screen.getByTestId('group-metric-stream-w1-label')).toHaveTextContent('You · GR withdrawn');
});
it.each([
  ['a withdrawal without its record',withdrawal()],
  ['a withdrawn record',{ ...competitionEvent,voided: true }],
])('labels %s withdrawn, with no figures', (_name,event) => {
  const card=renderCard(event);
  expect(screen.getByTestId(`group-metric-stream-${event.event_id}-label`)).toHaveTextContent('Friend · GR withdrawn');
  expect(card).not.toHaveTextContent(/45\.7|Score unavailable|Certif/);
});
it('labels absent score as unavailable rather than zero', () => {
  const card=renderCard({ ...competitionEvent,values: [{ ...competitionEvent.values[0],value: null,unavailable: true }] });
  expect(card).toHaveTextContent('Score unavailable',{ exact: false });
  expect(card).not.toHaveTextContent('0.0',{ exact: false });
});
it.each(['link','unlink','lead_change','rules_change'] as const)('renders %s with no rules text and opens the board history', kind => {
  const card=renderCard({ ...competitionEvent,kind,values: [],record_context: null });
  expect(card).toHaveTextContent('Pull-up',{ exact: false });
  expect(card).not.toHaveTextContent(/Rules|revision/);
  expect(card.props.accessibilityLabel).not.toMatch(/Rules|revision/);
  fireEvent.press(card);
  expect(mockPush).toHaveBeenCalledWith('/group/g1/leaderboards/ge1/history?metric=e1rm&scope=all');
});
it('says a rules change once', () => {
  const card=renderCard({ ...competitionEvent,kind: 'rules_change',values: [],record_context: null });
  expect(screen.getAllByText(/Group rules changed/)).toHaveLength(1);
  expect(card).not.toHaveTextContent(/recalculated|standard/);
});
it('opens a board history on a current metric only', () => {
  fireEvent.press(renderCard({ ...competitionEvent,kind: 'lead_change',metric: 'weight',values: [],record_context: null }));
  expect(mockPush).toHaveBeenCalledWith('/group/g1/leaderboards/ge1/history?metric=e1rm&scope=all');
});
it('shows training and the current witness, including my own attestation', () => {
  const card=renderCard({ ...competitionEvent,provisional: true,record_context: {
    ...competitionEvent.record_context!,metrics: [{ ...competitionEvent.record_context!.metrics[0],certification: competitionCertification }] } });
  expect(screen.getByTestId('group-metric-stream-event1-certification')).toHaveTextContent(/^Certified by you · /);
  expect(card).toHaveTextContent('Session in progress',{ exact: false });
});
it('shows one status per set however many boards the record took, and the set from the record stream', () => {
  const metric=competitionEvent.record_context!.metrics[0];
  renderCard({ ...competitionEvent,values: [...competitionEvent.values,{ ...competitionEvent.values[0],metric: 'volume',unit: 'percent_bw_reps',value: 650 }],
    record_context: { ...competitionEvent.record_context!,metrics: [metric,{ ...metric,metric: 'volume',write_token: 'v' }] } },
  { record: { performance: ordinarySet,previous: [],group_record_metrics: ['e1rm','volume'] } });
  expect(screen.getAllByTestId('group-metric-stream-event1-certification')).toHaveLength(1);
  expect(screen.getByTestId('group-metric-stream-event1-set')).toHaveTextContent('120.0 × 5');
  expect(screen.getByTestId('group-metric-stream-event1')).toHaveTextContent('Volume 650.0 %BW',{ exact: false });
});
it('says an ended certification and leaves a record with no current context without a status', () => {
  const metric=competitionEvent.record_context!.metrics[0];
  renderCard({ ...competitionEvent,record_context: { ...competitionEvent.record_context!,
    metrics: [{ ...metric,certification: { ...competitionCertification,ended_at_ms: 3000,end_reason: 'withdrawn' } }] } });
  expect(screen.getByTestId('group-metric-stream-event1-certification')).toHaveTextContent('Certification ended');
  screen.unmount();
  renderCard({ ...competitionEvent,record_context: null });
  expect(screen.queryByTestId('group-metric-stream-event1-certification')).toBeNull();
});
it('keeps the group and custom navigation accessible', () => {
  const onPress=jest.fn();
  const card=renderCard(competitionEvent,{ showGroupName: true,onPress });
  expect(card.props.accessibilityLabel).toContain('Crew');
  expect(card).not.toHaveTextContent(/View rules history|View record/);
  fireEvent.press(card);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});
