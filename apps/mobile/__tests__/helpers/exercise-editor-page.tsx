/**
 * The exercise editor page (`/exercise-edit`) over a caller under test, as the
 * root stack would show it. A suite's mocked `router.push` hands each href to
 * `exerciseEditorPage.push`; an `/exercise-edit` href mounts the real
 * `ExerciseEditorScreen` beside the caller (which stays mounted beneath, as
 * on device), with the request the caller registered, read the way
 * `app/exercise-edit.tsx` reads it. The page's `router.back()` (the suite's
 * mocked `back`, delegating to `exerciseEditorPage.back`) closes it, so a
 * save runs the caller's `onSaved` over real data.
 *
 *   const mockPush = jest.fn((href) => exerciseEditorPage.push(href));
 *   const mockBack = jest.fn(() => exerciseEditorPage.back());
 *   render(<WithExerciseEditorPage><CallerScreen /></WithExerciseEditorPage>);
 */

import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { readExerciseEditorRequest, releaseExerciseEditorRequest, resetExerciseEditorOpenGuard } from '@/components/exercise-catalog/exercise-editor-request';
import { ExerciseEditorScreen } from '@/components/exercise-catalog/exercise-editor-screen';

const EDIT_ROUTE = '/exercise-edit';

let openHref: string | null = null;
const listeners = new Set<() => void>();

const show = (href: string | null) => {
  openHref = href;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const readOpenHref = () => openHref;

/** `/exercise-edit` hrefs among a push mock's calls, in order. */
export const exerciseEditorHrefs = (push: jest.Mock): string[] =>
  push.mock.calls
    .map(([href]) => href)
    .filter((href): href is string => typeof href === 'string' && href.startsWith(EDIT_ROUTE));

/** The params an editor href carries. */
export const exerciseEditorParams = (href: string) => {
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  return { exerciseDefinitionId: query.get('exerciseDefinitionId'), request: query.get('request') };
};

export const exerciseEditorPage = {
  /** Opens the page for an `/exercise-edit` href; any other href is ignored. */
  push(href: unknown) {
    if (typeof href === 'string' && href.startsWith(EDIT_ROUTE)) show(href);
  },
  /** Closes the page when open (its Back or its save); else a no-op. */
  back() {
    if (openHref) show(null);
    // Tests open the editor again at once; the double-tap guard is real time.
    resetExerciseEditorOpenGuard();
  },
  isOpen: () => openHref !== null,
  /** Call in `beforeEach`: no page left open from the last test. */
  reset() {
    openHref = null;
    resetExerciseEditorOpenGuard();
  },
};

function EditorPage({ href }: { href: string }) {
  const { exerciseDefinitionId, request: token } = exerciseEditorParams(href);
  const [request] = useState(() => ({ ...readExerciseEditorRequest(token), exerciseDefinitionId }));
  useEffect(() => () => releaseExerciseEditorRequest(token), [token]);
  return <ExerciseEditorScreen request={request} />;
}

/** Renders `children` (the caller) and, while open, the editor page over it. */
export function WithExerciseEditorPage({ children }: { children: ReactNode }) {
  // An external store, so a push from the caller's own mount effect (an
  // `intent=add` route) still opens the page.
  const href = useSyncExternalStore(subscribe, readOpenHref, readOpenHref);
  return (
    <Fragment>
      {children}
      {href ? <EditorPage href={href} key={href} /> : null}
    </Fragment>
  );
}
