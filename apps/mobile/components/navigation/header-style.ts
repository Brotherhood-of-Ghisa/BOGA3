import { uiText } from '@/components/ui/text-roles';
import { uiRoles } from '@/components/ui/tokens';

/**
 * One header style on every header (`navigation-contract.md` "Header
 * titles"): the root stack's, and the Groups tab's in the tab layout.
 */
export const HEADER_STYLE_OPTIONS = {
  // The page's own `paper` ground with no shadow line, so header and
  // page read as one surface, the `title` role, an `ink` back arrow. The header
  // takes no line height, so only the role's face, weight, size and colour.
  headerStyle: { backgroundColor: uiRoles.paper },
  headerShadowVisible: false,
  headerTitleStyle: {
    fontFamily: uiText.title.fontFamily,
    fontWeight: uiText.title.fontWeight,
    fontSize: uiText.title.fontSize,
    color: uiText.title.color,
  },
  headerTintColor: uiRoles.ink,
} as const;
