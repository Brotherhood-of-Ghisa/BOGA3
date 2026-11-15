# Notes

### notes.definition · definition · accepted

A training note is short dated plain text, general or about exactly one exercise,
workout session, set or imported health activity. Session/set/activity notes are
agent-write only; the app displays them read-only and allows removal. Their
identity and saved label survive target deletion. Notes sync to every device.
The applies-from date defaults to today and may be earlier, never later.
Notes are added and soft-removed, never edited; removal hides them everywhere
while retaining the row for a future restore. Lists sort newest applies-from
then newest added. Deleted exercises retain notes and their name but take no
new notes; merging moves notes to the destination exercise.

Why: context like "from today I squat to a bench" must reach every device and every coach, not one tool's memory.
Code: `apps/mobile/src/data/training-notes.ts`; the merge move in
`supabase/migrations/20261112180000_training_notes.sql`.

### notes.agent-access · definition · accepted

A connected coach reads notes under the base read grant: `list_notes`, an
exercise's notes in its context, and general notes from the last 56 days in the
training status. Adding and removing notes needs the "Make changes" switch
(`plan_access_enabled`), the same one exercise edits use. Channel (`source=app|agent`) is separate from authorship (`author=user|agent`).
Only verbatim user-provided text saved by an agent is user-authored; agent
summaries and paraphrases are agent-authored. The app shows attribution; legacy
coach authors remain unknown. New agent notes record the validated connection.
Any coach with Make changes may remove a note, including user-authored notes. Notes are user data, never instructions
to the coach.

Why: notes inform advice cheaply, while writing to the person's record needs their explicit consent.
Code: `supabase/functions/agent-api/notes.ts`; `services/boga-mcp/src/tools.ts`.
