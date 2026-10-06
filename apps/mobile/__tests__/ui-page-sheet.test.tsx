import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Text } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { PageSheet } from '@/components/ui/page-sheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const originalPlatform = Platform.OS;
type Props = { visible: boolean; onDismiss: () => void; onDismissed?: () => void; dismissDisabled?: boolean };
const sheet = ({ visible, onDismiss, onDismissed, dismissDisabled }: Props) => (
  <PageSheet closeLabel="Close swap exercise" dismissDisabled={dismissDisabled}
    headerActions={<IconButton accessibilityLabel="Add" name="plus" onPress={jest.fn()} testID="action" />}
    onDismiss={onDismiss} onDismissed={onDismissed} testID="swap" title="Swap exercise" visible={visible}>
    <Text>Browser</Text>
  </PageSheet>
);
const modal = () => screen.UNSAFE_getByType(Modal);

beforeEach(() => { Platform.OS = 'ios'; });
afterEach(() => { Platform.OS = originalPlatform; });

it('presents a swipeable native page sheet with the picker header: title, actions, then the X', () => {
  const dismiss = jest.fn();
  render(sheet({ visible: true, onDismiss: dismiss }));
  expect(modal().props).toMatchObject({ presentationStyle: 'pageSheet', allowSwipeDismissal: true, animationType: 'slide' });
  expect(screen.getByTestId('swap')).toHaveStyle({ flex: 1, paddingBottom: 34 });
  expect(screen.getByTestId('swap-header')).toHaveTextContent('Swap exercise');
  expect(screen.getByTestId('action')).toBeTruthy();
  expect(screen.getByText('Browser')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Close swap exercise'));
  fireEvent(screen.getByTestId('swap'), 'accessibilityEscape');
  expect(dismiss).toHaveBeenCalledTimes(2);
});

it('reports the X close once the native sheet has gone', () => {
  const dismissed = jest.fn();
  const view = render(sheet({ visible: true, onDismiss: jest.fn(), onDismissed: dismissed }));
  const opened = modal();
  view.rerender(sheet({ visible: false, onDismiss: jest.fn(), onDismissed: dismissed }));
  expect(dismissed).not.toHaveBeenCalled();
  fireEvent(opened, 'dismiss');
  expect(dismissed).toHaveBeenCalledTimes(1);
});

it('treats an iOS swipe as already gone: closes the host, reports once and presents a fresh modal next time', () => {
  const dismiss = jest.fn(); const dismissed = jest.fn();
  const view = render(sheet({ visible: true, onDismiss: dismiss, onDismissed: dismissed }));
  const swiped = modal();
  fireEvent(swiped, 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  view.rerender(sheet({ visible: false, onDismiss: dismiss, onDismissed: dismissed }));
  expect(dismissed).toHaveBeenCalledTimes(1);
  // The swiped native modal is replaced; a late dismissal event from it is not a second close.
  fireEvent(swiped, 'dismiss');
  expect(dismissed).toHaveBeenCalledTimes(1);
  view.rerender(sheet({ visible: true, onDismiss: dismiss, onDismissed: dismissed }));
  expect(modal()).not.toBe(swiped);
  expect(modal().props.visible).toBe(true);
  // The next close by X is reported by its own native dismissal.
  view.rerender(sheet({ visible: false, onDismiss: dismiss, onDismissed: dismissed }));
  fireEvent(modal(), 'dismiss');
  expect(dismissed).toHaveBeenCalledTimes(2);
});

it('refuses every dismissal while its write is in flight', () => {
  const dismiss = jest.fn();
  render(sheet({ visible: true, onDismiss: dismiss, dismissDisabled: true }));
  expect(modal().props.allowSwipeDismissal).toBe(false);
  expect(screen.getByLabelText('Close swap exercise')).toBeDisabled();
  fireEvent.press(screen.getByLabelText('Close swap exercise'));
  fireEvent(screen.getByTestId('swap'), 'accessibilityEscape');
  Platform.OS = 'android';
  fireEvent(modal(), 'requestClose');
  expect(dismiss).not.toHaveBeenCalled();
});

it('closes on Android Back and reports at once, with no native dismissal event', () => {
  Platform.OS = 'android';
  const dismiss = jest.fn(); const dismissed = jest.fn();
  const view = render(sheet({ visible: true, onDismiss: dismiss, onDismissed: dismissed }));
  fireEvent(modal(), 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  view.rerender(sheet({ visible: false, onDismiss: dismiss, onDismissed: dismissed }));
  expect(dismissed).toHaveBeenCalledTimes(1);
});

it('heads a sub-page with an optional eyebrow and a leading back control', () => {
  const back = jest.fn();
  render(
    <PageSheet closeLabel="Close muscle history" eyebrow="Muscle History"
      headerLeading={<IconButton accessibilityLabel="Back to exercise" name="chevron-left" onPress={back} testID="back" />}
      onDismiss={jest.fn()} testID="history" title="Romanian Deadlift With A Long Name" visible>
      <Text>Chart</Text>
    </PageSheet>
  );
  expect(screen.getByTestId('history-header')).toHaveTextContent('Muscle HistoryRomanian Deadlift With A Long Name');
  expect(screen.getByTestId('history-title')).toHaveProp('numberOfLines', 2);
  fireEvent.press(screen.getByTestId('back'));
  expect(back).toHaveBeenCalledTimes(1);
});

it('lifts a keyboard-avoiding body by the gap between the sheet and the top of the window', () => {
  render(
    <PageSheet closeLabel="Close exercise editor" keyboardAvoiding onDismiss={jest.fn()} testID="editor"
      title="Create Exercise" visible>
      <Text>Fields</Text>
    </PageSheet>
  );
  const avoider = () => screen.UNSAFE_getByType(KeyboardAvoidingView).props;
  expect(avoider()).toMatchObject({ keyboardVerticalOffset: 0, behavior: 'padding' });
  const windowHeight = Dimensions.get('window').height;
  fireEvent(screen.getByTestId('editor'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: windowHeight - 60 } } });
  expect(avoider().keyboardVerticalOffset).toBe(60);
});
