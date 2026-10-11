/**
 * The stream's record lines and the developer drawer that re-enables hidden
 * event kinds. The nesting itself is groups-stream-packing.test.ts.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { GroupStreamEventsSheet } from '@/components/groups/stream-events-sheet';
import { GroupStreamSessionCard } from '@/components/groups/stream-session-card';
import type { CompetitionSessionCard } from '@/src/groups/competition-stream-view-model';

const card = (records: CompetitionSessionCard['records']): CompetitionSessionCard => ({
  kind: 'session',
  key: 'friend-1:s-1',
  groupId: 'g1',
  memberUserId: 'friend-1',
  sessionId: 's-1',
  memberName: 'alex',
  isTrainingNow: false,
  statusLabel: 'Completed · 1h 5m',
  startedAtLabel: '9/11 09:05',
  gymName: 'Iron Temple',
  groupNames: ['Crew'],
  setsLabel: '2 sets',
  exercisesLabel: '1 exercise',
  records,
});

const line = { key: 'r-1', exercise: 'Deadlift', value: '1RM 213.3 kg', certified: true, accessibilityLabel: 'Deadlift, 1RM 213.3 kg, certified' };

describe('a session card with its records', () => {
  it('draws each record inside the session and opens it by its stream key', () => {
    const onPressRecord = jest.fn();
    render(<GroupStreamSessionCard card={card([line])} onPress={jest.fn()} onPressRecord={onPressRecord} showGroupNames={false} />);

    const records = within(screen.getByTestId('group-stream-session-card-friend-1:s-1-records'));
    expect(records.getByText('Deadlift')).toBeTruthy();
    expect(records.getByText('1RM 213.3 kg')).toBeTruthy();
    fireEvent.press(screen.getByTestId('group-stream-session-card-friend-1:s-1-record-r-1'));
    expect(onPressRecord).toHaveBeenCalledWith('r-1');
  });

  it('shows no record block when the session took none', () => {
    render(<GroupStreamSessionCard card={card([])} onPress={jest.fn()} showGroupNames={false} />);
    expect(screen.queryByTestId('group-stream-session-card-friend-1:s-1-records')).toBeNull();
  });
});

describe('the event types drawer', () => {
  it('switches a hidden kind back on, and an shown one off', () => {
    const onChange = jest.fn();
    render(<GroupStreamEventsSheet hiddenKinds={['link', 'unlink']} onChange={onChange} onDismiss={jest.fn()} visible />);

    expect(screen.getByTestId('groups-stream-events-link').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('groups-stream-events-record').props.accessibilityState).toEqual({ checked: true });

    fireEvent.press(screen.getByTestId('groups-stream-events-link'));
    expect(onChange).toHaveBeenLastCalledWith(['unlink']);

    fireEvent.press(screen.getByTestId('groups-stream-events-record'));
    expect(onChange).toHaveBeenLastCalledWith(['link', 'unlink', 'record']);
  });
});
