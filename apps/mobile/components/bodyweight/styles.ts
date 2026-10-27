import { StyleSheet } from 'react-native';
import { uiGeometry, uiSpace } from '@/components/ui';

export const weightStyles = StyleSheet.create({
  form: { paddingHorizontal: uiSpace.lg, gap: uiSpace.md, paddingBottom: uiSpace.md },
  unitControl: { minHeight: uiGeometry.tapTarget },
  cardBody: { padding: uiSpace.md, gap: uiSpace.sm },
  section: { gap: uiSpace.sm },
});
