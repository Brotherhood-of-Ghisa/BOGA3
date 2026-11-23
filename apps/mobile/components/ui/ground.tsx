import { createContext, useContext, type ReactNode } from 'react';

// The ground a component's words sit on (`design-language.md` §2): the page,
// or a card or sheet laid over it. Words straight on the page take the page
// inks, words on a card the inks; the two differ only on Ink + paper, whose
// page is dark under light cards. `Card`, `Sheet` and `PageSheet` mark what
// they hold; a component that can sit on either (`FormSection`'s heading,
// `StatePanel`) reads it.
export type UiGround = 'page' | 'card';

const GroundContext = createContext<UiGround>('page');

/** Marks everything below as drawn on a card or a sheet. */
export function OnCard({ children }: { children: ReactNode }) {
  return <GroundContext.Provider value="card">{children}</GroundContext.Provider>;
}

/** The ground the caller's words sit on. */
export function useUiGround(): UiGround {
  return useContext(GroundContext);
}
