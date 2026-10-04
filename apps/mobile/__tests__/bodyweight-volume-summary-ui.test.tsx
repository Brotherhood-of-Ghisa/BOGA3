import { render, screen } from '@testing-library/react-native';
import { SessionSummaryCard } from '@/components/session-view/session-summary-card';
import { ViewSessionScreen } from '@/components/view-session/view-session-screen';
import { sessionVolumeSummary } from '@/src/exercise-calculations/analytics';
import type { VolumeCoverage } from '@/src/exercise-calculations/load-metrics';

const partial: VolumeCoverage = { knownVolumeKgReps: 500, totalVolumeKgReps: null,
  eligibleSetCount: 2, knownSetCount: 1, missingSetCount: 1, invalidSetCount: 0, complete: false, overflow: false };
const note = 'Volume incomplete. Known subtotal from 1 of 2 included sets.';

it('keeps an active session subtotal compact and its incomplete coverage readable', () => {
  render(<SessionSummaryCard startedAt={new Date()} gymName={null} workingSetCount={2}
    {...sessionVolumeSummary(partial)} onPressGym={() => {}} />);
  expect(screen.getByTestId('session-view-summary-volume').props.accessibilityLabel).toBe('Known vol 500');
  expect(screen.getByTestId('session-view-summary-volume-note')).toHaveTextContent(note);
});

it('keeps the same coverage visible on a completed session', () => {
  render(<ViewSessionScreen section="sets" onSectionChange={() => {}} summaryContent={null}
    summary={{ start: '2026-09-20 12:00', end: '2026-09-20 13:00', duration: '1h', gymName: null, deleted: false }}
    model={{ cards: [], workingSetCount: 2, ...sessionVolumeSummary(partial) }} error={null}
    onBack={() => {}} onEdit={() => {}} onToggleDeleted={() => {}} onAppend={() => {}} />);
  expect(screen.getByTestId('completed-session-detail-volume').props.accessibilityLabel).toBe('Known vol 500');
  expect(screen.getByTestId('completed-session-detail-summary-note')).toHaveTextContent(note);
});

it('distinguishes a known zero subtotal from entirely unavailable or complete volume', () => {
  expect(sessionVolumeSummary({ ...partial, knownVolumeKgReps: 0 })).toEqual({ volume: '0', volumeNote: note });
  expect(sessionVolumeSummary({ ...partial, knownVolumeKgReps: null, overflow: true }).volume).toBe('—');
  expect(sessionVolumeSummary({ ...partial, knownSetCount: 0 }).volumeNote).toContain('Volume unavailable');
  expect(sessionVolumeSummary({ ...partial, totalVolumeKgReps: 0, complete: true })).toEqual({ volume: '0' });
});
