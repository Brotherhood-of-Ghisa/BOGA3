/**
 * The form grammar's primitives (`components/ui/form-section.tsx`,
 * `ux-rules.md` "Forms"): a section's heading and error, a choice row's value
 * or placeholder, an input row's commit, an action row, and `SwitchRow`'s
 * form-card density.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChoiceRow, FormActionRow, FormError, FormSection, InputRow, SwitchRow } from '@/components/ui';

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

describe('FormActionRow', () => {
  it('is one labelled target, and does nothing while disabled', () => {
    const onPress = jest.fn();
    const view = render(<FormActionRow icon="link" label="Link to a group exercise" onPress={onPress} testID="action" />);
    fireEvent.press(screen.getByLabelText('Link to a group exercise'));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<FormActionRow disabled icon="link" label="Link to a group exercise" onPress={onPress} testID="action" />);
    fireEvent.press(screen.getByTestId('action'));
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
