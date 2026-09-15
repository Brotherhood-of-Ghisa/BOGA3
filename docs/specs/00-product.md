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
  - after submission, each performed exercise compares the session's raw entered volume with the median and fifth-to-ninety-fifth-percentile range of eligible earlier completed sessions,
  - muscle load is a session-wide summary using the same current-metadata, per-side, role-weighted semantics as history analytics,
  - successful submission opens a one-time completion presentation on the existing completed-session route; the presentation is not a persisted award or a historical-detail mode,
  - the share action previews and generates a session-summary PNG containing all PRs and exercise comparisons, then opens the platform share sheet; the app does not upload media, publish directly, include private gym/location data, or store a share record.
