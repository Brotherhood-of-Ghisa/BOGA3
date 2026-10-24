import { Card } from '@/components/ui/card';
import { StatePanel, type StatePanelProps } from '@/components/ui/state-panel';

/**
 * A Today message panel (loading, error, empty, signed out): its own card in
 * the list layout; in the cards layout (`fill`) the page is the card, so the
 * panel fills it and centres there.
 */
export function TodayPanel({ fill = false, ...panel }: Omit<StatePanelProps, 'fill'> & { fill?: boolean }) {
  if (fill) return <StatePanel {...panel} fill />;
  return (
    <Card>
      <StatePanel {...panel} fill={false} />
    </Card>
  );
}
