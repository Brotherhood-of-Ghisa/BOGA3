import { render, screen } from '@testing-library/react-native';
import { SessionSummaryCard } from '@/components/session-view/session-summary-card';
import { ViewSessionScreen } from '@/components/view-session/view-session-screen';
import { formatVolumeFigure } from '@/src/exercise-calculations/analytics';

// A Volume that left out a set whose load cannot be calculated reads like any
// other: no `Known vol` label and no coverage note ([[copy.no-inline-explanation]]).
it('shows an active session Volume under its plain label, with no note', () => {
  render(<SessionSummaryCard gymName={null} exerciseCount={1} workingSetCount={2}
    volume={formatVolumeFigure(500)} onPressGym={() => {}} />);
  expect(screen.getByTestId('session-view-summary-volume').props.accessibilityLabel).toBe('Volume 500');
  expect(screen.queryByTestId('session-view-summary-volume-note')).toBeNull();
});

it('shows a completed session Volume under its plain label, with no note', () => {
  render(<ViewSessionScreen section="sets" onSectionChange={() => {}} summaryContent={null}
    summary={{ title: 'Afternoon training · 20 Sep', start: '2026-09-20 12:00', duration: '1h', gymName: null, deleted: false }}
    model={{ cards: [], workingSetCount: 2, volume: formatVolumeFigure(500) }} error={null}
    onBack={() => {}} onEdit={() => {}} onToggleDeleted={() => {}} />);
  expect(screen.getByTestId('completed-session-detail-volume').props.accessibilityLabel).toBe('Volume 500');
  expect(screen.queryByTestId('completed-session-detail-summary-note')).toBeNull();
});

it('formats a known zero and dashes a sum that is not finite', () => {
  expect(formatVolumeFigure(0)).toBe('0');
  expect(formatVolumeFigure(1220.4)).toBe('1220');
  expect(formatVolumeFigure(null)).toBe('—');
  expect(formatVolumeFigure(Infinity)).toBe('—');
});
