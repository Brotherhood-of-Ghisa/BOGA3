import { useMemo } from 'react';

import type { UiRoles } from '@/components/ui/theme';
import { useUiRoles } from '@/components/ui/theme-context';
import { textRolesFor } from '@/components/ui/text-roles';

/**
 * One header style on every header (`navigation-contract.md` "Header
 * titles"): the root stack's, and the Groups tab's in the tab layout.
 */
export function headerStyleOptions(roles: UiRoles) {
  const { title } = textRolesFor(roles).text;
  return {
    // The page's own `paper` ground with no shadow line, so header and
    // page read as one surface, the `title` role, an `ink` back arrow. The header
    // takes no line height, so only the role's face, weight, size and colour.
    headerStyle: { backgroundColor: roles.paper },
    headerShadowVisible: false,
    headerTitleStyle: {
      fontFamily: title.fontFamily,
      fontWeight: title.fontWeight,
      fontSize: title.fontSize,
      color: title.color,
    },
    headerTintColor: roles.ink,
  } as const;
}

// The header style in the roles the app is drawn in now.
export function useHeaderStyleOptions() {
  const roles = useUiRoles();
  return useMemo(() => headerStyleOptions(roles), [roles]);
}
