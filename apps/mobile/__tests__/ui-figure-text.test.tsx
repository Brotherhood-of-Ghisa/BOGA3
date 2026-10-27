import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextEmphasis, uiTextTone } from '@/components/ui/text-roles';

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

  it('draws a hyphenated date as one figure', () => {
    render(
      <Text>
        <FigureText>{'Certified by sam · 12-10-2026'}</FigureText>
      </Text>,
    );

    expect(screen.getByText('12-10-2026')).toHaveStyle(uiText.inlineFigure);
  });

  it('leaves a name that starts with a digit, like 1RM, in the words', () => {
    render(
      <Text testID="line">
        <FigureText>{'1RM 213.3 · 10RM 80'}</FigureText>
      </Text>,
    );

    expect(screen.getByText('213.3')).toHaveStyle(uiText.inlineFigure);
    expect(screen.getByText('80')).toHaveStyle(uiText.inlineFigure);
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.getByTestId('line')).toHaveTextContent('1RM 213.3 · 10RM 80');
  });

  it("draws the figures in a toned line's own weight", () => {
    render(
      <Text>
        <FigureText figureStyle={uiTextTone.record}>1RM 120.0</FigureText>
      </Text>,
    );

    expect(screen.getByText('120.0')).toHaveStyle({ fontFamily: uiText.inlineFigure.fontFamily, fontWeight: '700' });
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
