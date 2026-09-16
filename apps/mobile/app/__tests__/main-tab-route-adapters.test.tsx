import { render, screen } from '@testing-library/react-native';

import TrainRouteAdapter from '../(tabs)/train';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: 'route-adapter-redirect' }, href),
  };
});

describe('M26 dormant route adapters', () => {
  it.each([
    ['Train', TrainRouteAdapter, '/session-recorder'],
  ])('%s preserves access to an existing destination before cutover', (_name, Route, href) => {
    render(<Route />);
    expect(screen.getByTestId('route-adapter-redirect').props.children).toBe(href);
  });
});
