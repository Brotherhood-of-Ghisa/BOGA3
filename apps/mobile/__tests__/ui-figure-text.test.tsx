import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextEmphasis } from '@/components/ui/text-roles';

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

  it('keeps a sign and a slash in the words, and the figures either side of them', () => {
    render(
      <Text testID="line">
        <FigureText>{'+45 · 1.5/8'}</FigureText>
      </Text>,
    );

    for (const figure of ['45', '1.5', '8']) {
      expect(screen.getByText(figure)).toHaveStyle(uiText.inlineFigure);
    }
    expect(screen.getByTestId('line')).toHaveTextContent('+45 · 1.5/8');
  });

  it('draws the figures of an emphasised line at its weight, not the figure face weight', () => {
    render(
      <Text>
        <FigureText strong>Started 07:40</FigureText>
      </Text>,
    );

    expect(screen.getByText('07:40')).toHaveStyle({ ...uiText.inlineFigure, ...uiTextEmphasis.strong });
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
