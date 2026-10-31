/**
 * The form grammar's primitives (`components/ui/form-section.tsx`,
 * `ux-rules.md` "Forms"): a section's heading and error, a choice row's value
 * or placeholder, an input row's commit, an action row, and `SwitchRow`'s
 * form-card density.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ActionRow, ChoiceRow, FormError, FormSection, InputRow, SwitchRow, uiRoles } from '@/components/ui';

import { drawsGlyph } from './helpers/draws-glyph';

describe('FormSection', () => {
  it('heads its card with the group name and shows one error under it', () => {
    render(
      <FormSection error="Pick one." errorTestID="section-error" testID="section" title="Muscles">
        <ChoiceRow label="Primary" onPress={jest.fn()} />
      </FormSection>,
    );
    expect(screen.getByRole('header')).toHaveTextContent('Muscles');
    expect(screen.getByTestId('section-error')).toHaveTextContent('Pick one.');
  });

  it('shows its footnote under the card, muted, above any error', () => {
    render(
      <FormSection error="Pick one." errorTestID="section-error" footnote="Applies next launch" testID="section" title="Theme">
        <ChoiceRow label="Primary" onPress={jest.fn()} />
      </FormSection>,
    );
    expect(screen.getByTestId('section-footnote')).toHaveTextContent('Applies next launch');
    expect(screen.getByTestId('section-error')).toHaveTextContent('Pick one.');
  });

  it('shows no footnote without one', () => {
    render(<FormSection testID="section" title="Theme"><ChoiceRow label="Primary" onPress={jest.fn()} /></FormSection>);
    expect(screen.queryByTestId('section-footnote')).toBeNull();
  });

  it('shows no error line without an error', () => {
    render(<FormError message={null} testID="none" />);
    expect(screen.queryByTestId('none')).toBeNull();
  });
});

describe('ChoiceRow', () => {
  it('shows the current value and says it, and opens its picker', () => {
    const onPress = jest.fn();
    render(<ChoiceRow label="Primary" onPress={onPress} placeholder="Choose" testID="choice" value="Chest" />);
    expect(screen.getByTestId('choice')).toHaveTextContent('Chest', { exact: false });
    expect(screen.getByLabelText('Primary: Chest')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('choice'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([[null], ['']])('shows the placeholder for an empty value (%p)', (value) => {
    render(<ChoiceRow label="Secondary" onPress={jest.fn()} placeholder="None" testID="choice" value={value} />);
    expect(screen.getByLabelText('Secondary: None')).toBeOnTheScreen();
  });

  it('draws its leading icon only when given one', () => {
    const view = render(<ChoiceRow icon="bell" label="Notifications" onPress={jest.fn()} />);
    expect(drawsGlyph(view.root, 'bell')).toBe(true);
    view.rerender(<ChoiceRow label="Notifications" onPress={jest.fn()} />);
    expect(drawsGlyph(view.root, 'bell')).toBe(false);
  });

  it('says none without a value or placeholder', () => {
    render(<ChoiceRow label="Gym" onPress={jest.fn()} />);
    expect(screen.getByLabelText('Gym: none')).toBeOnTheScreen();
  });
});

describe('InputRow', () => {
  it('edits in place, shows the default as its placeholder, and commits when editing ends', () => {
    const onChangeText = jest.fn();
    const onEndEditing = jest.fn();
    render(
      <InputRow label="Rest timer (s)" onChangeText={onChangeText} onEndEditing={onEndEditing} placeholder="90" testID="input" value="" />,
    );
    const input = screen.getByTestId('input');
    expect(input).toHaveProp('placeholder', '90');
    expect(input).toHaveProp('accessibilityLabel', 'Rest timer (s)');
    fireEvent.changeText(input, '60');
    fireEvent(input, 'endEditing');
    expect(onChangeText).toHaveBeenCalledWith('60');
    expect(onEndEditing).toHaveBeenCalledTimes(1);
  });
});

describe('ActionRow', () => {
  it('is one labelled target, and does nothing while disabled', () => {
    const onPress = jest.fn();
    const view = render(<ActionRow icon="link" label="Link to a group exercise" onPress={onPress} testID="action" />);
    fireEvent.press(screen.getByLabelText('Link to a group exercise'));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<ActionRow disabled icon="link" label="Link to a group exercise" onPress={onPress} testID="action" />);
    fireEvent.press(screen.getByTestId('action'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a chevron only for a row that navigates, which is the default kind', () => {
    const view = render(<ActionRow label="Review changes" onPress={jest.fn()} />);
    expect(drawsGlyph(view.root, 'chevron-right')).toBe(true);
    view.rerender(<ActionRow kind="navigate" label="Review changes" onPress={jest.fn()} />);
    expect(drawsGlyph(view.root, 'chevron-right')).toBe(true);
    view.rerender(<ActionRow kind="act" label="Refresh" onPress={jest.fn()} />);
    expect(drawsGlyph(view.root, 'chevron-right')).toBe(false);
    view.rerender(<ActionRow kind="danger" label="Wipe local" onPress={jest.fn()} />);
    expect(drawsGlyph(view.root, 'chevron-right')).toBe(false);
  });

  it('puts accent words on navigate and act, and danger words on danger', () => {
    const view = render(<ActionRow label="Review changes" onPress={jest.fn()} />);
    expect(screen.getByText('Review changes')).toHaveStyle({ color: uiRoles.accent });
    view.rerender(<ActionRow kind="act" label="Export database" onPress={jest.fn()} />);
    expect(screen.getByText('Export database')).toHaveStyle({ color: uiRoles.accent });
    view.rerender(<ActionRow kind="danger" label="Wipe local" onPress={jest.fn()} />);
    expect(screen.getByText('Wipe local')).toHaveStyle({ color: uiRoles.danger });
    view.rerender(<ActionRow kind="danger" disabled label="Wipe local" onPress={jest.fn()} />);
    expect(screen.getByText('Wipe local')).toHaveStyle({ color: uiRoles.inkGhost });
  });

  it('presses a danger or act row, and blocks a disabled one', () => {
    const onPress = jest.fn();
    const view = render(<ActionRow kind="danger" label="Wipe local" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Wipe local'));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<ActionRow disabled kind="danger" label="Wipe local" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Wipe local'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SwitchRow in a form card', () => {
  it('takes list density and a divider, and toggles as one switch', () => {
    const onValueChange = jest.fn();
    render(<SwitchRow density="list" divider label="Uses bodyweight" onValueChange={onValueChange} testID="switch" value={false} />);
    const row = screen.getByTestId('switch');
    expect(row).toHaveStyle({ borderTopWidth: 1 });
    fireEvent.press(row);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});

describe('SwitchRow description', () => {
  it('shows a muted line under the label and reads it with the switch', () => {
    const onValueChange = jest.fn();
    render(<SwitchRow density="list" description="Allowed" label="Notifications" onValueChange={onValueChange} testID="switch" value />);
    expect(screen.getByText('Allowed')).toBeOnTheScreen();
    const row = screen.getByRole('switch', { name: 'Notifications, Allowed' });
    expect(row).toBeChecked();
    fireEvent.press(row);
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('keeps the label as its name without a description', () => {
    render(<SwitchRow label="Notifications" onValueChange={jest.fn()} value={false} />);
    expect(screen.getByRole('switch', { name: 'Notifications' })).not.toBeChecked();
  });
});

describe('FormSection without a title', () => {
  it('draws its card with no heading', () => {
    render(<FormSection testID="bare"><Text>Row</Text></FormSection>);
    expect(screen.getByText('Row')).toBeOnTheScreen();
    expect(screen.queryByRole('header')).toBeNull();
  });
});
