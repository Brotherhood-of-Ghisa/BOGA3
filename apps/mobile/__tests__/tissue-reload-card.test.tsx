import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TissueReloadCard } from '@/components/injuries/tissue-reload-card';
import type { TissueReloadMetrics } from '@/src/injuries/tissue-reload';

const makeMetrics = (overrides: Partial<TissueReloadMetrics> = {}): TissueReloadMetrics => ({
  injuryId: overrides.injuryId ?? 'inj-1',
  muscleGroupId: Object.prototype.hasOwnProperty.call(overrides, 'muscleGroupId')
    ? overrides.muscleGroupId!
    : 'quads',
  muscleGroupName: Object.prototype.hasOwnProperty.call(overrides, 'muscleGroupName')
    ? overrides.muscleGroupName!
    : 'Quadriceps',
  label: overrides.label ?? 'Patellar tendinitis',
  side: Object.prototype.hasOwnProperty.call(overrides, 'side')
    ? overrides.side!
    : 'left',
  status: overrides.status ?? 'managing',
  painScore: Object.prototype.hasOwnProperty.call(overrides, 'painScore')
    ? overrides.painScore!
    : 5,
  baselineWeeklyAverage: overrides.baselineWeeklyAverage ?? 4.0,
  currentWeeklyWorkingSets: overrides.currentWeeklyWorkingSets ?? 6,
  currentWeeklyRehabSets: overrides.currentWeeklyRehabSets ?? 2,
  currentWeeklyRehabVolumeKg: overrides.currentWeeklyRehabVolumeKg ?? 300,
  spikePercent: overrides.spikePercent ?? 50,
  isCautionAlert: overrides.isCautionAlert ?? true,
  cautionThreshold: overrides.cautionThreshold ?? 5.2,
});

describe('TissueReloadCard', () => {
  it('renders recovering structure details with weekly volume and pre-injury baseline', () => {
    const item = makeMetrics({
      injuryId: 'inj-quads',
      muscleGroupId: 'quads',
      muscleGroupName: 'Quadriceps',
      side: 'left',
      label: 'Patellar tendon irritation',
      status: 'managing',
      painScore: 4,
      baselineWeeklyAverage: 4.0,
      currentWeeklyWorkingSets: 6,
      currentWeeklyRehabSets: 2,
      currentWeeklyRehabVolumeKg: 300,
      isCautionAlert: true,
      spikePercent: 50,
    });

    render(<TissueReloadCard metrics={[item]} />);

    expect(screen.getByText('Tissue Reloading')).toBeTruthy();
    expect(screen.getByText('Left Quadriceps')).toBeTruthy();
    expect(screen.getByText('Patellar tendon irritation')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('· 2 rehab (300 kg)')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('(+50%)')).toBeTruthy();
  });

  it('renders caution alert banner when isCautionAlert is true', () => {
    const item = makeMetrics({
      isCautionAlert: true,
      currentWeeklyWorkingSets: 8,
      baselineWeeklyAverage: 5.0,
      cautionThreshold: 6.5,
      spikePercent: 60,
    });

    render(<TissueReloadCard metrics={[item]} />);

    const alertBanner = screen.getByTestId('tissue-reload-caution-badge');
    expect(alertBanner).toBeTruthy();
    expect(alertBanner.props.accessibilityRole).toBe('alert');
    expect(screen.getByTestId('tissue-reload-caution-title')).toBeTruthy();
    expect(screen.getByText(/Caution: Volume spike/)).toBeTruthy();
  });

  it('suppresses caution alert banner when isCautionAlert is false', () => {
    const item = makeMetrics({
      isCautionAlert: false,
      currentWeeklyWorkingSets: 5,
      baselineWeeklyAverage: 5.0,
      spikePercent: 0,
    });

    render(<TissueReloadCard metrics={[item]} />);

    expect(screen.queryByTestId('tissue-reload-caution-badge')).toBeNull();
    expect(screen.queryByTestId('tissue-reload-caution-title')).toBeNull();
  });

  it('calls onSelectMuscle when a recovering structure row is tapped', () => {
    const onSelectMuscle = jest.fn();
    const item = makeMetrics({
      injuryId: 'inj-hamstrings',
      muscleGroupId: 'hamstrings',
      muscleGroupName: 'Hamstrings',
      side: 'right',
    });

    render(<TissueReloadCard metrics={[item]} onSelectMuscle={onSelectMuscle} />);

    const row = screen.getByLabelText(/View reload metrics for Right Hamstrings/);
    fireEvent.press(row);

    expect(onSelectMuscle).toHaveBeenCalledWith('hamstrings');
  });

  it('renders clean empty state when no active injuries exist', () => {
    render(<TissueReloadCard metrics={[]} />);

    expect(screen.getByTestId('tissue-reload-empty')).toBeTruthy();
    expect(screen.getByText('No recovering structures currently tracked.')).toBeTruthy();
  });

  it('renders zero pre-injury baseline with "New baseline" indicator', () => {
    const item = makeMetrics({
      baselineWeeklyAverage: 0,
      currentWeeklyWorkingSets: 6,
      isCautionAlert: true,
      spikePercent: null,
    });

    render(<TissueReloadCard metrics={[item]} />);

    expect(screen.getByText('(New baseline)')).toBeTruthy();
    expect(screen.getByTestId('tissue-reload-caution-badge')).toBeTruthy();
  });

  it('renders negative trend, un-sided structure, null pain score, and acute status', () => {
    const item = makeMetrics({
      injuryId: 'inj-acute',
      muscleGroupId: 'chest',
      muscleGroupName: null,
      side: null,
      status: 'acute',
      painScore: null,
      currentWeeklyWorkingSets: 4,
      currentWeeklyRehabSets: 0,
      currentWeeklyRehabVolumeKg: 0,
      baselineWeeklyAverage: 8.0,
      spikePercent: -50,
      isCautionAlert: false,
    });

    render(<TissueReloadCard metrics={[item]} selectedMuscleId="chest" />);

    expect(screen.getByText('1 structure')).toBeTruthy();
    expect(screen.getByText('chest')).toBeTruthy();
    expect(screen.getByText('(-50%)')).toBeTruthy();
    expect(screen.getByText('· 0 rehab')).toBeTruthy();
  });

  it('renders monitoring status and right-sided muscle without onSelect', () => {
    const item = makeMetrics({
      injuryId: 'inj-mon',
      muscleGroupId: 'calves',
      muscleGroupName: 'Calves',
      side: 'right',
      status: 'monitoring',
      painScore: 2,
      isCautionAlert: false,
    });

    render(<TissueReloadCard metrics={[item]} />);

    expect(screen.getByText('Right Calves')).toBeTruthy();
    expect(screen.queryByLabelText(/View reload metrics for/)).toBeNull();
  });
});
