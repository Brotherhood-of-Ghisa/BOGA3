import { StyleSheet } from 'react-native';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

export const weightStyles = StyleSheet.create({
  body: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.inkMuted },
  label: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase', color: uiRoles.inkMuted },
  form: { paddingHorizontal: uiSpace.lg, gap: uiSpace.md, paddingBottom: uiSpace.md },
  unitControl: { minHeight: uiGeometry.tapTarget },
  cardBody: { padding: uiSpace.md, gap: uiSpace.sm },
  section: { gap: uiSpace.sm },
});
