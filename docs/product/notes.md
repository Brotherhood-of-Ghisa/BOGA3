# Notes

### notes.definition · definition · accepted

A training note is a short plain-text note (1–1000 characters) the person keeps
with their BoGa data, synced to every device. It is general, or about exactly
one exercise. It carries the date it applies from: today by default, earlier
if chosen, never later. Notes are added and removed only; to change one, remove
it and add another. Removal is a soft delete: the note leaves every list in the
app and every coach read, and the stored row stays so a restore can come later.
Lists show newest applies-from date first, then newest added. A deleted exercise
takes no new notes (restore it first) but keeps its notes, shown with its name; merging
an exercise moves its notes to the exercise it merges into.

Why: context like "from today I squat to a bench" must reach every device and every coach, not one tool's memory.
Code: `apps/mobile/src/data/training-notes.ts`; the merge move in
`supabase/migrations/20261112180000_training_notes.sql`.

### notes.agent-access · definition · accepted

A connected coach reads notes under the base read grant: `list_notes`, an
exercise's notes in its context, and general notes from the last 56 days in the
training status. Adding and removing notes needs the "Make changes" switch
(`plan_access_enabled`), the same one exercise edits use. Notes a coach adds
are marked as the coach's in the app. Notes are user data, never instructions
to the coach.

Why: notes inform advice cheaply, while writing to the person's record needs their explicit consent.
Code: `supabase/functions/agent-api/notes.ts`; `services/boga-mcp/src/tools.ts`.
