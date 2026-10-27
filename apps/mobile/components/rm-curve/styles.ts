import { StyleSheet } from 'react-native';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

export const curveStyles = StyleSheet.create({
  card: { padding: uiSpace.md, gap: uiSpace.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.sm },
  filter: { flexGrow: 1, flexBasis: '45%', minWidth: 0 },
  full: { width: '100%' },
  // A line in a row beside others (the legend, the date range): it wraps
  // rather than pushing them out.
  shrink: { flexShrink: 1 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm, flexWrap: 'wrap' },
  dot: { width: 12, height: 12, borderWidth: uiBorder.width, borderColor: uiRoles.ink, borderRadius: uiGeometry.radius.pill },
  dates: { flexDirection: 'row', justifyContent: 'space-between', gap: uiSpace.sm, flexWrap: 'wrap' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.md },
  metric: { flexBasis: '45%', flexGrow: 1, gap: uiSpace.xs, minWidth: 0 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: uiSpace.sm },
});
