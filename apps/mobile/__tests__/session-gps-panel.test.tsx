/* eslint-disable import/first */

/**
 * The gym sheet's developer GPS panel (`components/session-view/session-gps-panel.tsx`):
 * it renders the acquisition's diagnostics — the fix, the last read, and why
 * the sheet is or is not suggesting — only when the sheet is given the
 * developer-mode inputs, and never otherwise.
 */

const mockQueryAll = jest.fn();
jest.mock('@/src/session-recorder/gym-options', () => ({
  activeGymOptions: (gyms: unknown[]) => gyms,
  listGymDirectory: () => mockQueryAll() as Promise<unknown[]>,
}));

import { render, screen } from '@testing-library/react-native';
import { SessionGymSheet } from '@/components/session-view/session-gym-sheet';
import type { SessionPositionState } from '@/src/location/session-position';

const availableState: SessionPositionState = {
  status: 'available',
  position: { latitude: 51.5, longitude: -0.12, accuracyM: 30, capturedAt: new Date('2026-09-23T10:00:00Z') },
  attempts: 2,
  lastRead: { status: 'success', accuracyM: 30 },
  gaveUpReason: null,
};

const unavailableState: SessionPositionState = {
  status: 'unavailable',
  position: null,
  attempts: 3,
  lastRead: { status: 'read_failure', accuracyM: null },
  gaveUpReason: 'read_error',
};

const renderSheet = (gpsPanel: Parameters<typeof SessionGymSheet>[0]['gpsPanel']) =>
  render(
    <SessionGymSheet
      gpsPanel={gpsPanel}
      onDismiss={() => {}}
      onManage={() => {}}
      onSelect={() => {}}
      options={[]}
      selectedGymId={null}
      suggestions={[]}
      visible
    />
  );

describe('session gym sheet GPS panel', () => {
  it('renders the diagnostics behind the developer inputs', () => {
    renderSheet({ state: availableState, nearbyGymCount: 3, suggestionCount: 2 });

    expect(screen.getByTestId('session-gps-panel')).toBeTruthy();
    expect(screen.getByTestId('session-gps-value-fix')).toHaveTextContent('Held · ±30 m');
    expect(screen.getByTestId('session-gps-value-last-read')).toHaveTextContent('read ok · ±30 m');
    expect(screen.getByTestId('session-gps-value-coordinates')).toHaveTextContent('51.50000, -0.12000 · ±30 m');
    expect(screen.getByTestId('session-gps-value-suggestions')).toHaveTextContent('2 of 3 gyms within 1 km');
  });

  it('explains a give-up instead of a fix', () => {
    renderSheet({ state: unavailableState, nearbyGymCount: 1, suggestionCount: 0 });

    expect(screen.getByTestId('session-gps-value-fix')).toHaveTextContent('Given up · Location read failed');
    expect(screen.getByTestId('session-gps-value-suggestions')).toHaveTextContent('Location read failed');
  });

  it('says no gym is within reach of a held fix', () => {
    renderSheet({ state: availableState, nearbyGymCount: 4, suggestionCount: 0 });

    expect(screen.getByTestId('session-gps-value-suggestions')).toHaveTextContent('No gym within 1 km (4 gyms searched)');
  });

  it('renders nothing without the developer inputs', () => {
    renderSheet(undefined);

    expect(screen.queryByTestId('session-gps-panel')).toBeNull();
  });

  it('renders nothing before the acquisition starts', () => {
    renderSheet({ state: null, nearbyGymCount: null, suggestionCount: 0 });

    expect(screen.getByTestId('session-gps-value-fix')).toHaveTextContent('Not started');
    expect(screen.getByTestId('session-gps-value-suggestions')).toHaveTextContent('Gyms still loading');
  });
});
