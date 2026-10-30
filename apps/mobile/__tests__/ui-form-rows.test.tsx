/**
 * The Settings row vocabulary beyond the form basics (`components/ui/form-rows.tsx`,
 * `ux-rules.md` "Forms"): each row renders its label or value, fires its
 * callback, and exposes the right accessibility role and state.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { CheckRow, FormSection, RadioRow, SegmentRow, ValueRow } from '@/components/ui';

import { drawsGlyph } from './helpers/draws-glyph';

const VIEWS = [
  { value: 'list', label: 'List' },
  { value: 'body', label: 'Body' },
] as const;

describe('SegmentRow', () => {
  it('names its setting over a segmented control and changes the choice', () => {
    const onChange = jest.fn();
    render(<SegmentRow label="Muscle view" onChange={onChange} options={VIEWS} testID="row" testIDPrefix="view" value="list" />);
    expect(screen.getByText('Muscle view')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'List' })).toBeSelected();
    fireEvent.press(screen.getByTestId('view-body'));
    expect(onChange).toHaveBeenCalledWith('body');
    expect(screen.getByTestId('view-row')).toBeOnTheScreen();
  });

  it('does not change while disabled', () => {
    const onChange = jest.fn();
    render(<SegmentRow disabled label="Muscle view" onChange={onChange} options={VIEWS} testIDPrefix="view" value="list" />);
    fireEvent.press(screen.getByTestId('view-body'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RadioRow', () => {
  it('is a radio that says whether it is chosen, and chooses on press', () => {
    const onPress = jest.fn();
    const view = render(<RadioRow checked label="Ember" onPress={onPress} testID="radio" />);
    expect(screen.getByRole('radio', { name: 'Ember' })).toBeChecked();
    expect(drawsGlyph(view.root, 'radio-on')).toBe(true);
    fireEvent.press(screen.getByTestId('radio'));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<RadioRow checked={false} label="Ember" onPress={onPress} testID="radio" />);
    expect(screen.getByRole('radio', { name: 'Ember' })).not.toBeChecked();
    expect(drawsGlyph(view.root, 'radio-off')).toBe(true);
  });

  it('shows its meta at the row end', () => {
    render(<RadioRow checked={false} label="Ember" meta={<Text>swatch</Text>} onPress={jest.fn()} />);
    expect(screen.getByText('swatch')).toBeOnTheScreen();
  });

  it('blocks presses while disabled', () => {
    const onPress = jest.fn();
    render(<RadioRow checked={false} disabled label="Ember" onPress={onPress} />);
    fireEvent.press(screen.getByRole('radio', { name: 'Ember' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('CheckRow', () => {
  it('is a checkbox that says whether it is on, with a check only while on', () => {
    const onPress = jest.fn();
    const view = render(<CheckRow checked label="Show weight" onPress={onPress} testID="check" />);
    expect(screen.getByRole('checkbox', { name: 'Show weight' })).toBeChecked();
    expect(drawsGlyph(view.root, 'check')).toBe(true);
    fireEvent.press(screen.getByTestId('check'));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<CheckRow checked={false} label="Show weight" onPress={onPress} testID="check" />);
    expect(screen.getByRole('checkbox', { name: 'Show weight' })).not.toBeChecked();
    expect(drawsGlyph(view.root, 'check')).toBe(false);
  });

  it('blocks presses while disabled and says so', () => {
    const onPress = jest.fn();
    render(<CheckRow checked disabled label="Show weight" onPress={onPress} />);
    const row = screen.getByRole('checkbox', { name: 'Show weight' });
    expect(row).toBeDisabled();
    fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('ValueRow', () => {
  it('reads its label and value as one element, with no chevron and nothing to press', () => {
    const view = render(<ValueRow label="Last backup" testID="value" value="Today, 09:41" />);
    expect(screen.getByLabelText('Last backup: Today, 09:41')).toBeOnTheScreen();
    expect(screen.getByTestId('value')).toHaveProp('accessible', true);
    expect(screen.getByText('Today, 09:41')).toBeOnTheScreen();
    expect(drawsGlyph(view.root, 'chevron-right')).toBe(false);
  });

  it('takes an explicit accessibility label', () => {
    render(<ValueRow accessibilityLabel="Version 1.2" label="Version" value="1.2" />);
    expect(screen.getByLabelText('Version 1.2')).toBeOnTheScreen();
  });

  it('stacks in a section as a card of rows', () => {
    render(
      <FormSection title="About">
        <ValueRow label="Version" value="1.2" />
        <ValueRow divider label="Build" value="42" />
      </FormSection>,
    );
    expect(screen.getByLabelText('Version: 1.2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Build: 42')).toBeOnTheScreen();
  });
});
