import { StatePanel, type StatePanelProps } from '@/components/ui/state-panel';

/**
 * A Today message panel (loading, error, empty, signed out): the page is the
 * card, so the panel fills it and centres there.
 */
export function TodayPanel(panel: Omit<StatePanelProps, 'fill'>) {
  return <StatePanel {...panel} fill />;
}
