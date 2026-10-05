# BOGA Session Import JSON Contract

This folder owns source-app digestion scripts. Digesters convert external exports
into a source-neutral JSON package for a later importer. Digesters must not write
rows into BOGA SQLite.

## Schema

The importer and GymBook digester emit the clean package identifier:

```text
boga.session-import.v4
```

The package is importer-ready only when:

- `report.unresolvedExercises` is empty;
- every `sessions[].exercises[].sourceExerciseName` has an entry in
  `exerciseDecisions`;
- each exercise decision either maps to an existing local
  `exercise_definitions.id` or declares a `create_new` import key;
- gym assignments are either an existing local `gyms.id` or `null`.

Review drafts may contain unresolved exercises only when generated with an
explicit draft/review flag. The generic importer must reject such packages.

## Remote Write Path

Remote imports must write through the app sync API (`sync_push`) with a target
user JWT, not by direct table mutation. Use:

```bash
npm run import:boga-json:remote -- --input <boga-import.json> --dry-run
```

After reviewing the dry-run entity counts, write mode requires
`--confirm-target` matching `target.importingProfileLabel`.

## Top-Level Shape

```json
{
  "schema": "boga.session-import.v4",
  "bodyweightCalculationsEnabled": false,
  "bodyWeightMeasurements": [],
  "generatedAt": "2026-06-04T12:00:00.000Z",
  "target": {
    "importingProfileLabel": "Human-readable local profile/user",
    "localDatabasePath": "/optional/path/to/scaffolding-local.db",
    "catalogSnapshot": {
      "exercises": [{ "id": "exercise-id", "name": "Bench Press" }],
      "gyms": [{ "id": "gym-id", "name": "Lunch Gym" }]
    }
  },
  "source": {
    "app": "GymBook",
    "exportFile": {
      "path": "GymBook-Logs-2026-06-04.xml",
      "sizeBytes": 123,
      "sha256": "..."
    },
    "timezone": "Europe/London",
    "rowCount": 10,
    "skippedRowCount": 1
  },
  "options": {
    "sessionClusterGapMinutes": 90,
    "shortSessionThresholdMinutes": 30,
    "shortSessionDefaultDurationMinutes": 60,
    "longSessionWarningThresholdMinutes": 90,
    "dateStartLocal": "2024-12-23",
    "dateEndLocal": "2026-07-16",
    "gymAssignments": {
      "midday": "gym-id-or-null",
      "weekdayEvening": "gym-id-or-null",
      "weekend": "gym-id-or-null"
    }
  },
  "exerciseDecisions": [],
  "sessions": [],
  "report": {}
}
```

## Session Shape

Each session is a completed BOGA session candidate:

- `startedAt` / `completedAt`: ISO timestamps derived from source local date/time.
- `durationSec`: importer-ready session duration.
- `rawSpanSec`: raw span between first and last source set timestamp.
- `gymId`: existing gym id or `null`.
- `gymBucket`: `midday`, `weekday_evening`, `weekend`, or `none`.
- `sourceWorkoutNames`: original source workout labels represented in the cluster.
- `warnings`: duration and review warnings for this session.

Session exercises preserve deterministic block order and contain a
`targetExercise`:

```json
{
  "kind": "existing",
  "exerciseDefinitionId": "exercise-id",
  "exerciseName": "Bench Press"
}
```

or:

```json
{
  "kind": "create",
  "importExerciseKey": "gymbook-create-zercher-squat",
  "exerciseName": "Zercher Squat"
}
```

Sets use BOGA-ready string values:

- `repsValue`: source reps as a string.
- `weightValue`: kg numeric text with the unit stripped. GymBook sets with no
  source weight, including bodyweight/reps-only sets, are imported as `0`.
- `setType`: `null`, `warm_up`, `technique`, `cooldown`, or canonical `rir_<n>` for a non-negative safe
  integer (for example `rir_0`, `rir_4`). Stored/imported RIRs remain valid even
  outside the fixed RIR-4–0 picker. Imported
  packages may leave this as `null`, or may classify historical effort when the
  source data is good enough. Source set-type text is preserved under
  `source.type`.

Non-empty source notes are preserved under set `source.note` and summarized in
`report.notes` because the current BOGA session/set schema has no notes column.

## GymBook Digester Rules

- Parse GymBook UTF-16LE XML with `<logs>/<log>` rows.
- Skip rows where `skipped` is `Yes` and report the count.
- Optional local-date windows are inclusive at `dateStartLocal` and exclusive at
  `dateEndLocal`.
- Infer sessions by same-date timestamp clusters, not GymBook workout name.
- Default cluster gap is 90 minutes.
- If raw span is under 30 minutes, output a 60 minute duration and warn.
- If raw span is over 90 minutes, warn for review.
- Optional effort enrichment starts with Warm-up, then blank, then descends
  from RIR-4 to RIR-0 and stays at RIR-0.
- Effort enrichment leaves endurance swing variants, including
  `Kettlebell Swings` and `Kettlebell One-Arm Swings`, with unregistered set
  effort.
- Weight normalization halves GymBook total-weight entries for exercises that
  BOGA logs per implement. `Arnold Presses` are treated as a two-dumbbell
  total-weight exercise; `Low Cable Flys` are treated as a bilateral cable total
  weight; `One-Arm Arnold Presses` and `Ball Dumbbell Pullovers` are not halved.
- Exact exercise-name matches against the target catalog map automatically.
- Missing exercises require an explicit decision file or draft mode.
- Gym bucket choices must be explicit: midday, weekday evening, and weekend;
  pass `none` for buckets that should produce no gym assignment.


## Optional bodyweight calculations and kg-only values

V4 is the clean export/import shape. The serializer
`serializeBogaSessionImportPackage` validates before export; local and
`sync_push` import paths preserve the same fields.

- Top-level `bodyweightCalculationsEnabled` is a required boolean. It restores
  the private preference for a full package; an importer operating in
  session-only mode must leave the recipient's existing preference unchanged.
- Top-level `bodyWeightMeasurements` is an array (empty allowed) of `id`,
  positive finite `weightKg` and UTC ISO `measuredAt`. Readings cannot be later
  than package generation/import time and remain owner-private.
- Sessions contain no bodyweight fields. Only the explicit reading array creates
  readings; a session never creates an override or prompt.
- A `create_new` exercise decision supplies `loadInputMode` and
  `bodyweightContribution` in `[0,1]`. `map_existing` never overwrites the
  existing personal contribution.
- Actual/planned Weight text is kg. Each set supplies `plannedWeightValue`,
  `plannedRepsValue`, `plannedSetType` and `performanceStatus`; an absent plan
  uses nulls. Status is null (confirmed), `planned`, or `unperformed`; import
  never implicitly confirms a planned/unperformed row.
- Objects accept only the documented keys; unknown fields make the package
  invalid instead of being ignored.

The live importer accepts this schema only and contains no alternate decoding
branch.

Generated exercise/session IDs deliberately retain the original stable identity
salt. That string is an identity namespace, not an accepted package schema, and
prevents an already imported workout from being duplicated after an offline
conversion. Reading IDs use a deterministic import namespace.

Remote imports send `x-boga-sync-protocol: 4`; mismatched protocol requests are
rejected before writes.
