/* eslint-disable import/first */

const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    dismissTo: mockDismissTo,
    replace: mockReplace,
  }),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';

import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';

describe('MoreHubBackButton', () => {
  beforeEach(() => {
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    mockSearchParams = {};
  });

  it('renders nothing when source parameter is not more', () => {
    const { toJSON } = render(<MoreHubBackButton />);
    expect(toJSON()).toBeNull();

    mockSearchParams = { source: 'session' };
    const { toJSON: toJSONSession } = render(<MoreHubBackButton />);
    expect(toJSONSession()).toBeNull();
  });

  it('renders back arrow button and replaces to More on press when source=more', () => {
    mockSearchParams = { source: 'more' };
    render(<MoreHubBackButton />);

    const button = screen.getByTestId('back-to-more-button');
    expect(button).toBeTruthy();
    expect(button.props.accessibilityLabel).toBe('Back to More');

    fireEvent.press(button);

    expect(mockReplace).toHaveBeenCalledWith('/more');
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('dismisses to More on press when returnBy is dismiss', () => {
    mockSearchParams = { source: 'more' };
    render(<MoreHubBackButton returnBy="dismiss" />);

    const button = screen.getByTestId('back-to-more-button');
    fireEvent.press(button);

    expect(mockDismissTo).toHaveBeenCalledWith('/more');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('handles array source param correctly', () => {
    mockSearchParams = { source: ['more', 'other'] };
    render(<MoreHubBackButton />);

    const button = screen.getByTestId('back-to-more-button');
    fireEvent.press(button);

    expect(mockReplace).toHaveBeenCalledWith('/more');
  });
});
