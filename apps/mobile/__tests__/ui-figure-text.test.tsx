import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { uiText } from '@/components/ui/text-roles';

describe('FigureText', () => {
  it('draws each figure in the figure face and leaves the words to the line', () => {
    render(
      <Text testID="line">
        <FigureText>{'Started 10:05 · 2 exercises · 102.5 kg'}</FigureText>
      </Text>,
    );

    for (const figure of ['10:05', '2', '102.5']) {
      expect(screen.getByText(figure)).toHaveStyle(uiText.inlineFigure);
    }
    expect(screen.getByTestId('line')).toHaveTextContent('Started 10:05 · 2 exercises · 102.5 kg');
  });

  it('adds nothing to a line without figures', () => {
    render(
      <Text testID="line">
        <FigureText>Today</FigureText>
      </Text>,
    );

    expect(screen.getByTestId('line')).toHaveTextContent('Today');
    expect(screen.UNSAFE_getAllByType(Text)).toHaveLength(1);
  });
});
