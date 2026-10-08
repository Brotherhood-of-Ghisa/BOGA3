# What are we building

> **Owns:** product overview and domain context. **Not here:** technical choices → `03`; data model → `05`. **Load when:** you need product/domain context.

## Document scope

This document provides an overview of our product and current product-level decisions.

## One paragraph description

A Gym Tracking application with a delightful interface, advanced analytics, AI powered advisor and Social Groups so that no one can cheat on their PRs again!

* Simple, quick, interface that combines depth and delightful golden paths.
* Powerful analytics that allows an incredible level of geek out.
* Exercises support Locations and are connected to Muscle Groups trained.
* Brotherhoods (Group) concept enables PR certification, Group level competitions, Group sanctioned Exercises. 
* AI integration powers AI coaches and AI analysis of performance trends.

## Product decisions (current)

- Date: `2026-02-27`
- Decision: Exercise and mapping metadata semantics are retroactive.
- Notes:
  - edits to exercise metadata apply across history presentation,
  - edits to muscle mapping metadata apply across history presentation,
  - future analytics interpretation is based on latest metadata (no versioned/snapshot metadata model is currently planned).

- Date: `2026-09-13`
- Decision: Current-session feedback keeps exercise PRs, exercise-volume context, and session muscle load as separate, derived signals.
- Notes:
  - a PR belongs to the exercise that produced it and requires a strict estimated-1RM improvement over prior eligible completed history; a first performance without a baseline is not a PR,
  - session volume comparisons follow [[session.volume-comparison]],
  - muscle load is a session-wide summary using the same current-metadata, per-side, role-weighted semantics as history analytics,
  - successful submission opens a one-time completion presentation on the existing completed-session route; the presentation is not a persisted award or a historical-detail mode,
  - the share action previews and generates a session-summary PNG containing all PRs and exercise comparisons, then opens the platform share sheet; the app does not upload media, publish directly, include private gym/location data, or store a share record.


- Date: `2026-09-28`
- Decision: Ordinary exercise logging is the default for every exercise. Weight
  is optional, kg-only and interpreted with the exercise's total/per-side input
  mode. What counts, the records and the calculations (blank Weight, zero
  results) are `tech/training-metrics-contract.md`.
- Decision: Private users and groups independently opt into bodyweight-aware
  calculations. Each exercise then has one editable `Bodyweight contribution
  (%)`; zero keeps ordinary math. Disabling either capability hides and ignores
  its contributions without deleting them or dated readings. Personal and group
  contributions never copy across an exercise link.
- Decision: Dated kg readings remain private and are selected at or before the
  exact session start. Personal calculations silently treat a missing applicable
  reading as zero so logging and analytics remain available. Strict group scoring
  omits a bodyweight-dependent score when the member has no applicable reading,
  while preserving raw shared activity. A group may use the reading internally
  but never disclose its value, date, identifier, history or dependency digest.
- Decision: Current preferences, contributions and dated readings reinterpret
  derived history without rewriting raw sets (`Top weight` stays raw; contract
  §4). User-facing calculation surfaces
  use only `Weight`, `Top weight`, `1RM` and `Volume` and do not expose the
  calculation breakdown. The complete boundary is owned by
  `tech/bodyweight-load-contract.md`.
