---
task_id: M25-T07-Mobile_linking
milestone_id: "M25"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "expo|node"
gates: "./boga test fast, ./boga test handles, ./boga test frontend, ./boga test ios-groups-e2e (+ whatever ./boga test for prints)"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/08-ux-delivery-standard.md (UX patterns), docs/specs/tech/groups-contract.md (§6.1–§6.3), docs/specs/tech/sync-v2-server-contract.md (§A.2.10 client note)"
---

# M25-T07 — Mobile linking: picker search, pick sheet, Link screen

- Depends on: T01 (#287, group exercises + client wrappers), T03 (#286,
  `exercise_group_links` Sync v2 entity). Milestone:
  `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`.
- Read: product E0.1–E0.3, P2, P3, P4, P17, D8, D9, D13, "Weight entry"
  (`docs/plans/group-exercises-and-leaderboards.md`); design §1, §2, §7
  (`docs/plans/group-exercises-tech-design.md`); `groups-contract.md` §2.7,
  §4.4, §6, §7; `sync-v2-server-contract.md` §A.2.10.
- Parallel: T08 (group page) also touches group screens and may add the same
  `group-exercises:<groupId>` cache key. Whichever merges second rebases and
  reuses the other's key and hook rather than adding a second one.

## Objective

A member links their own exercises to their groups' exercises from where they
already work: picker search while logging (E0.1), a pick sheet for an
unlinked group exercise (E0.2), and a Link screen from the catalogue ⋮ and
recorder ••• menus (E0.3). Linking and unlinking work offline. Group
exercises never appear in the default picker or catalogue lists (P3, D9).

## Settled design points (from T03's review)

**(a) "Add as new" is one local transaction.** `linkExercise` opens its own
transaction, so `src/data/exercise-group-links.ts` gains a tx-scoped writer
`linkExerciseInTransaction(tx, exerciseDefinitionId, groupId,
groupExerciseId, now)`. It returns whether it wrote. `linkExercise` becomes a
thin wrapper around it: open a transaction, call it, nudge after commit.
`src/data/exercise-catalog.ts` likewise extracts the body of
`saveExercise` into a tx-scoped `writeExerciseGraph(tx, …)`, and the store
calls it. A new `createExerciseWithGroupLink(input, link)` (in
`exercise-group-links.ts`) validates like `saveExercise`, runs
`writeExerciseGraph` and `linkExerciseInTransaction` in **one**
`database.transaction`, calls `notifyLocalWrite()` once after commit, and
invalidates the exercise catalogue cache. If either write throws, neither row
exists.

*Muscles.* `saveExercise` requires at least one muscle link, and a group
exercise has none. So "Add as new" opens the existing exercise editor modal,
prefilled with the group exercise's name and load mode. When
`source_exercise_id` is a bundled seed id, its seed muscle mappings are
prefilled too. On save, the editor calls `createExerciseWithGroupLink`, and
the recorder adds the new exercise to the session. The editor's fields do not
change (E0.3: "the exercise editor itself doesn't change").

**(b) The UI never links a soft-deleted exercise.** The repository stays
permissive: pulled rows and LWW undelete must apply as-is, and such a link is
inert on the server. The UI enforces the rule:
- Catalogue ⋮: **Link to group exercise…** is disabled for a deleted exercise
  (like Edit).
- The pick sheet's suggestion and its "Choose another" list offer only live
  exercises.
- If the Link screen is opened for a deleted exercise, it shows "Restore this
  exercise to link it". Existing links are still listed, and **Unlink** still
  works.

**(c) Where each fact is read offline.**

| Fact | Source | Offline |
| --- | --- | --- |
| Linked or not, and to which group exercise | local `exercise_group_links` (`listLinks()`) | Always; reflects a local write immediately |
| My groups (names) | `group_cache` `groups:mine` | Cached copy |
| A group's exercises (name, load mode, source id, archived) | `group_cache` `group-exercises:<groupId>` (new key), refreshed online with `listGroupExercises` | Cached copy |

- A link whose group-exercise entry is missing from the cache still renders,
  with the placeholder name "Group exercise" (and "A group" when the group
  name is also missing, design §7). It updates on the next refresh.
- Only group exercises present in the cache can be linked. You can't link to
  something you can't see.
- A link into a group I'm no longer in (not in `groups:mine`) stays under
  **Linked**, marked "inactive — not a member" (P4), with **Unlink**.
- An archived group exercise is never offered for a new link (D8). An
  existing link to one shows "archived".
- `evictGroup` also deletes `group-exercises:<groupId>`. Links are never
  evicted: they are the member's synced data.

**Other rules pinned here**
- **One link per group** (P2): an exercise already linked in group G shows
  every other group exercise in G as unavailable ("already linked in G").
  The UI never retargets silently.
- **Suggestion** (E0.2, E0.3):
  1. my live exercise whose id equals the group exercise's
     `source_exercise_id` (seeded exercises are `seed_<slug>`);
  2. else the best name match, using the catalogue search normalization;
  3. never an exercise already linked in that group.
  With no candidate, "Add as new" is preselected.
- **Several of my exercises linked to one group exercise** (P2): picking it
  in the picker opens the pick sheet listing just those linked exercises. No
  new link is written.
- **Weight-entry note** (D6): if my load mode differs from the group
  exercise's, the pick sheet and Link screen say "Your per-side weights will
  show doubled on this group's boards." (or "…total-load weights will show
  halved…").
- **Signed out or auth unconfigured:** the menu items are hidden and the
  picker has no group section. Nothing calls a group RPC.

## Scope

- **Data (`src/data/`)**:
  - `linkExerciseInTransaction` and `createExerciseWithGroupLink` in
    `exercise-group-links.ts`;
  - the `writeExerciseGraph` extraction in `exercise-catalog.ts`, with
    behaviour unchanged.
  - No change to `src/sync/**`, the schema, or migrations.
- **Groups (`src/groups/`)**:
  - the `group-exercises:<groupId>` cache key and its eviction;
  - a cache-first hook loading every group's exercises (per-group
    `listGroupExercises`, the same refresh and offline rules as
    `useGroupResource`);
  - a pure `link-view-model.ts`: the picker group section and Groups-toggle
    list, pick-sheet options and suggestion, Link-screen sections (Linked /
    Suggested / All by group), availability, placeholders, and the
    load-mode note.
- **UI**:
  - *Recorder picker*: a "From your groups" section after my own matches when
    the search text is non-empty. A **Groups** toggle beside the search box
    narrows the list to group exercises, grouped by group, including with
    empty search text. Rows read "linked: <my exercise>" or "not linked".
    Picking a linked row adds my exercise; picking an unlinked row opens the
    pick sheet.
  - *Pick sheet* (`components/groups/`, an in-route `Modal`):
    - the suggestion;
    - "Choose another of your exercises…", a search over my live exercises;
    - "Add "<name>" as a new exercise";
    - the retroactivity line ("Your past <exercise> sets shared with <group>
      will count.") and the load-mode note;
    - **Link and add**, which writes the link and adds my exercise to the
      session.
  - *Link screen*: a new route `app/exercise-link.tsx`
    (`/exercise-link?exerciseDefinitionId=<id>`), title `Link "<name>"`. It
    has a search over group exercises only, the Linked / Suggested / All
    sections, **Link** with the retroactivity line, and **Unlink** with a
    confirm ("Your sets from this exercise will leave <group>'s
    leaderboards."). Missing or unknown ids show an error state.
  - *Menus*: **Link to group exercise…** in the catalogue ⋮ Exercise Actions
    and the recorder ••• menu. Each pushes the Link screen; Back returns.

Out of scope: the group page Exercises tab and its "Link your exercise" entry
(E0.4, T08), boards and conversion maths (T05, T09), and any server change.

## Acceptance criteria

1. **Atomic "Add as new"** (jest, in-memory fixture):
   - `createExerciseWithGroupLink` writes the definition, its mappings, and
     the link, all dirty, in one transaction, with one write nudge.
   - A forced failure in the link write leaves no definition row, and the
     reverse also holds.
   - `linkExercise` behaviour is unchanged (the T03 tests stay green).
2. **Offline linking** (jest):
   - With the network reported offline and a warm cache, Link, Unlink, and
     Link and add each write locally and update the UI at once.
   - No group RPC runs.
   - Linked state renders from `exercise_group_links` with the cache empty,
     using the placeholder names.
3. **Rules** (jest, view model): soft-deleted exercises are never offered
   (b); one link per group shows as unavailable; archived group exercises are
   not offered but existing links to them render; the suggestion order and
   exclusions; inactive links for groups I've left; the load-mode note in
   both directions.
4. **Picker** (jest, screen):
   - With empty search and the toggle off, the list is unchanged. A snapshot
     or row-set assertion shows no group rows.
   - With search text, the group section comes after my matches.
   - The toggle shows group exercises only.
   - Picking a linked row adds my exercise; picking an unlinked row opens the
     pick sheet.
   - Signed out, there is no group section.
5. **Link screen and menus** (jest, screen): both menu entries navigate to
   `/exercise-link?exerciseDefinitionId=…`; Link, and Unlink after its
   confirm; deleted-exercise state; missing-id error state.
6. **Eviction** (jest): `NOT_FOUND` for a group evicts
   `group-exercises:<id>` and leaves links untouched.
7. **E2E** (`ios-groups-e2e`): one new flow with its own fixture user
   (spec 11, hermetic). The user is a member of a group that has a group
   exercise. The flow:
   1. opens the catalogue ⋮ **Link to group exercise…** and links;
   2. searches the recorder picker and sees "linked: <exercise>";
   3. picks the group exercise and sees the user's own exercise added to the
      session.
8. `src/groups` and `src/sync` still do not import each other.
   `isDevMode()` gates anything dev-only; there is no `__DEV__`.

## UX Contract (spec 08)

- **Link from the catalogue**
  - Trigger: ⋮ → Link to group exercise…
  - Steps: the Link screen opens → search, or scan Suggested → **Link**.
  - Success: the row moves to Linked, with the retroactivity line.
  - Failure or edge: offline with no cache shows "Connect once to load your
    groups' exercises". A deleted exercise shows "Restore this exercise to
    link it".
- **Unlink**
  - Trigger: **Unlink** on a Linked row.
  - Steps: confirm (destructive, pattern 3).
  - Success: the row returns to the available list.
  - Failure or edge: cancelling changes nothing.
- **Pick a group exercise while logging**
  - Trigger: search text in the picker, or the Groups toggle.
  - Steps: tap a group row. A linked row adds my exercise. An unlinked row
    opens the pick sheet → choose → **Link and add**.
  - Success: the link is written and my exercise appears in the session.
  - Failure or edge: with no suggestion, "Add as new" is preselected and
    opens the prefilled editor. A cancelled editor writes nothing.
- **Interaction notes**
  - Group rows reuse the picker row style, with a secondary "· <group>" label
    and status text. Status is text, not color.
  - The pick sheet follows the existing in-route `Modal` conventions.
  - The Link screen uses section headers like the picker's family headers.
  - New pattern for 08: **secondary-source search section** (results from
    another source listed after the user's own, plus a narrowing toggle).

## Docs touched

- `ui/screen-map.md`: Link screen; picker and menu additions.
- `ui/navigation-contract.md`: the `/exercise-link` route and its
  transitions from `/exercise-catalog` and `/session-recorder`.
- `ui/components-catalog.md`: the pick sheet and the group picker section.
- `08` UX patterns: the new pattern above.
- `groups-contract.md` §6.1–§6.3: the new key, hook, view model, and route.
- `sync-v2-server-contract.md` §A.2.10: a one-line note on the tx-scoped
  writer and the "UI never links a deleted exercise" rule.
- Delete this card in the PR.
