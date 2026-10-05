import { fireEvent, render, screen } from '@testing-library/react-native';
import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import type { CompetitionEventWire } from '@/src/groups/competition-wire';
import { competitionEvent,competitionCertification } from './helpers/competition-fixtures';
const mockPush=jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
beforeEach(() => jest.clearAllMocks());
const renderCard=(item: CompetitionEventWire,props: Partial<Parameters<typeof GroupMetricStreamCard>[0]> = {}) => {
  render(<GroupMetricStreamCard item={item} userId="me" showGroupName={false} {...props} />);
  return screen.getByTestId(`group-metric-stream-${item.event_id}`);
};
it('shows original normalized units and reps without raw load, bodyweight or dependency pins', () => {
  const card=renderCard(competitionEvent);
  expect(card).toHaveTextContent('1RM 145.7 %BW',{ exact: false });
  expect(card).toHaveTextContent('As logged: 5 reps',{ exact: false });
  expect(card).toHaveTextContent('Uncertified',{ exact: false });
  expect(card.props.accessibilityLabel).toContain('1RM 145.7 %BW');
  expect(card.props.accessibilityLabel).not.toMatch(/kg|bodyweight reading|fingerprint|digest/);
  fireEvent.press(card);
  expect(mockPush).toHaveBeenCalledWith('/group/g1/leaderboards/ge1/history?metric=e1rm&scope=all&revision=2');
});
it.each([
  ['e1rm','kg',120,'1RM 120.0 kg'],['volume','kg_reps',600,'Volume 600.0 kg·reps'],
  ['volume','percent_bw_reps',620,'Volume 620.0 %BW·reps'],
] as const)('keeps %s original unit %s', (metric,unit,value,line) => {
  const card=renderCard({ ...competitionEvent,metric,values: [{ ...competitionEvent.values[0],metric,unit,value }] });
  expect(card).toHaveTextContent(line,{ exact: false });
});
it.each(['record_voided','record'] as const)('uses generic ended copy for %s and never reads the private cause', kind => {
  const event={ ...competitionEvent,kind,voided: true };
  Object.defineProperty(event,'reason',{ get: () => { throw new Error('private cause read'); } });
  const card=renderCard(event);
  expect(card).toHaveTextContent('Certification ended',{ exact: false });
  expect(card).toHaveTextContent('Score unavailable',{ exact: false });
  expect(card).not.toHaveTextContent('145.7',{ exact: false });
});
it('labels absent score as unavailable rather than zero', () => {
  const card=renderCard({ ...competitionEvent,values: [{ ...competitionEvent.values[0],value: null,unavailable: true }] });
  expect(card).toHaveTextContent('Score unavailable',{ exact: false });
  expect(card).not.toHaveTextContent('0.0',{ exact: false });
});
it.each(['link','unlink','lead_change','rules_change'] as const)('renders %s with its revision history', kind => {
  const card=renderCard({ ...competitionEvent,kind,values: [],record_context: null });
  expect(card).toHaveTextContent('Pull-up · Rules 2',{ exact: false });
  fireEvent.press(card);
  expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('revision=2'));
});
it('shows training and the current witness, including my own attestation', () => {
  const card=renderCard({ ...competitionEvent,provisional: true,record_context: {
    ...competitionEvent.record_context!,metrics: [{ ...competitionEvent.record_context!.metrics[0],certification: competitionCertification }] } });
  expect(card).toHaveTextContent('Certified by you',{ exact: false });
  expect(card).toHaveTextContent('Session in progress',{ exact: false });
});
it('keeps the group and custom navigation accessible', () => {
  const onPress=jest.fn();
  const card=renderCard(competitionEvent,{ showGroupName: true,onPress,pressHint: 'Opens the group' });
  expect(card.props.accessibilityLabel).toContain('Crew');
  expect(card).toHaveTextContent('Opens the group',{ exact: false });
  fireEvent.press(card);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});
