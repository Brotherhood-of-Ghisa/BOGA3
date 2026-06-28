# M18 - Group Exercise Catalogue and Private Exercise Mapping

## Milestone metadata

- Milestone ID: `M18`
- Title: Milestone: Group Exercise Catalogue and Private Exercise Mapping
- Status: `planned`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- AuthN/AuthZ guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Project structure: `docs/specs/09-project-structure.md`

## Milestone objective

Introduce the first group-sharing domain slice: a user can create a private group, administer group membership/catalogue governance, map their private exercise definitions to group-sanctioned exercise definitions, and share a completed session into a group projection without exposing unrelated private exercise metadata.

## MVP scope

1. Create group.
2. Group owner/admin role.
3. Group exercise catalogue.
4. User private exercise -> group exercise mapping.
5. Share session to group using mapped group exercises.
6. Unmapped exercise flow during share.
7. Group exercise creation requests.
8. Admin review queue.

## In scope

- Group records, membership records, and owner/admin authorization semantics.
- Group exercise catalogue records scoped to a group, not to an individual user's private catalogue.
- Per-user mapping from private `exercise_definitions` rows to group exercise rows.
- Share-session projection that emits group-visible session/exercise data using group exercise identifiers/names rather than private exercise metadata.
- Share-time handling for unmapped exercises, including request-or-skip decisions.
- Group exercise creation request lifecycle and admin review queue.
- Backend RLS/constraint coverage for groups, memberships, mappings, requests, and shared projections.
- Mobile service-layer seams and UI flows required by the MVP.
- Dev seed data and QA scenarios for at least one owner/admin, one member, mapped exercises, unmapped exercises, and request review.

## Out of scope

- Public/global exercise catalogue shared across all groups.
- Cross-group exercise federation or automatic deduplication.
- Group competitions, leaderboards, PR certification, comments, reactions, or notifications.
- Background group feed sync beyond what is required to persist and display this MVP's direct share/review flows.
- Changing the existing private exercise catalogue semantics for non-group tracker usage.
- Synchronizing edits made to a private session after it has been shared (projection drift resolution is deferred to post-MVP; shared sessions are treated as static snapshots at the time of sharing).
- Adapting the Sync v2 protocol/contract and client engine to support shared multi-user scopes, such as local caching/syncing of group catalogues, memberships, and shared projections (group operations remain online-only backend calls for this MVP; sync integration is deferred to post-MVP).

## Domain and privacy rules

1. A user's existing `exercise_definitions` remain private user-owned rows unless explicitly mapped or projected through a group share action.
2. Group exercise rows are group-scoped catalogue entries governed by group owner/admin permissions.
3. A private-to-group mapping is owned by the mapping user and must not give other group members read access to that user's private exercise row.
4. Sharing a session to a group creates a group-visible projection. The projection uses mapped group exercise identifiers and stores only fields intentionally needed for the group view. For the MVP, this projection is a static snapshot at the time of sharing; subsequent edits to the private source session do not propagate to the shared projection.
5. Unmapped private exercises must be resolved before share completion by mapping to an existing group exercise, requesting a new group exercise, or excluding the exercise from the group projection.
6. Admin review actions must be backend-enforced by group role/RLS; mobile UI affordances are not an authorization boundary.

## Deliverables

1. Supabase schema, constraints, and RLS for groups, memberships, group exercise catalogue rows, private-to-group mappings, exercise creation requests, and share projections.
2. Mobile service layer for loading group catalogue data, maintaining mappings, preparing share projections, and submitting/reviewing group exercise requests.
3. User-facing group creation, mapping, unmapped-share, catalogue-admin, and review-queue UI flows.
4. Automated privacy/authorization/projection tests, plus seed/dev fixtures and QA scenarios.
5. Updates to project-level architecture, data-model, auth/RLS, testing, sync/server-contract, and UI docs as individual tasks make behavior source-of-truth.

## Acceptance criteria

1. A signed-in user can create a group and becomes its owner/admin.
2. Owner/admin users can create and manage group exercise catalogue entries for their group.
3. A group member can map their private exercise definition to a group exercise without exposing the private definition row to other members.
4. A member can share a completed session to a group when all included exercises have mappings or explicit share-time decisions.
5. Shared group session data renders with group exercise names/ids and does not leak unmapped/private exercise names through the group projection.
6. Unmapped exercises during share present a clear flow to map existing group exercises, request a new group exercise, or skip those exercises for the share.
7. Members can submit group exercise creation requests, and owner/admin users can approve/reject them through an admin queue.
8. RLS and negative-path tests prove non-members and non-admin members cannot read/write unauthorized group, mapping, request, or projection rows.
9. The required local gates for each implementation slice are green before the slice is marked complete.

## Task breakdown

1. `docs/tasks/M18-T01-Audit_existing_exercise_session_schema_and_privacy_assumptions.md` - Audit existing exercise/session schema and privacy assumptions (`planned`).
2. `docs/tasks/M18-T02-Design_group_domain_data_model.md` - Design group/domain data model (`planned`).
3. `docs/tasks/M18-T03-Add_Supabase_migrations_for_groups_and_group_memberships.md` - Add Supabase migrations for groups and group memberships (`planned`).
4. `docs/tasks/M18-T04-Add_group_exercise_catalogue_tables.md` - Add group exercise catalogue tables (`planned`).
5. `docs/tasks/M18-T05-Add_private_to_group_exercise_mapping_table.md` - Add private-to-group exercise mapping table (`planned`).
6. `docs/tasks/M18-T06-Add_group_exercise_request_table_and_lifecycle_states.md` - Add group exercise request table and lifecycle states (`planned`).
7. `docs/tasks/M18-T07-Add_RLS_policies_for_groups_members_admins_mappings_requests.md` - Add RLS policies for groups, members, admins, mappings, requests (`planned`).
8. `docs/tasks/M18-T08-Add_service_layer_for_group_catalogue_and_mappings.md` - Add service layer for group catalogue and mappings (`planned`).
9. `docs/tasks/M18-T09-Add_share_session_to_group_projection_logic.md` - Add share-session-to-group projection logic (`planned`).
10. `docs/tasks/M18-T10-Build_group_catalogue_admin_UI.md` - Build group catalogue admin UI (`planned`).
11. `docs/tasks/M18-T11-Build_user_mapping_UI.md` - Build user mapping UI (`planned`).
12. `docs/tasks/M18-T12-Build_unmapped_exercise_flow_during_sharing.md` - Build unmapped exercise flow during sharing (`planned`).
13. `docs/tasks/M18-T13-Build_admin_review_queue_for_exercise_requests.md` - Build admin review queue for exercise requests (`planned`).
14. `docs/tasks/M18-T14-Add_tests_for_privacy_and_projection_behaviour.md` - Add tests for privacy and projection behaviour (`planned`).
15. `docs/tasks/M18-T15-Add_seed_dev_data_and_QA_scenarios.md` - Add seed/dev data and QA scenarios (`planned`).

## Risks / dependencies

- Group sharing intentionally crosses the current user-private sync-domain boundary, so tasks must separate private source rows from group-visible projections before implementation.
- RLS complexity increases because group membership/role checks replace simple `owner_user_id = auth.uid()` policies for group-visible data.
- Share projection must define exactly which session fields are safe for group visibility before UI implementation.
- The mobile app may need new navigation surfaces and Maestro coverage once group UI flows are introduced.
- Sync-contract changes may be required if any new group data must be available offline or participate in local-first convergence; otherwise group operations should remain explicit authenticated backend calls for this MVP.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note (status remains `in_progress`).
