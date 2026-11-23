import { StyleSheet, View } from 'react-native';

import { statusStripGround } from '@/components/navigation/navigation-theme';
import { useUiRoles } from '@/components/ui/theme-context';

/**
 * The strip behind the status bar, laid over the top of a card-ground bar
 * that runs under it: the bar's own ground, or the page's wherever the clock,
 * styled for the page, would not read on the bar's. Only Ink + paper's light
 * bars over its dark page show the page.
 */
export function StatusStrip({ height }: { height: number }) {
  const roles = useUiRoles();
  return <View pointerEvents="none" style={[styles.strip, { height, backgroundColor: statusStripGround(roles, roles.surface) }]} />;
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, left: 0, right: 0 },
});
