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

- Date: `2026-09-12` (shipped in M22; the numbers are the group brainstorm's decision log)
- Decision: Private groups with a shared stream of members' training.
- Notes:
  - there is no maximum group size (2);
  - when a member leaves, everything they shared stays (4);
  - all of a member's performed sets are visible to their groups, not only a subset (5);
  - a session belongs to the groups its owner was in when they started it: a new member sees the group's whole record, but their own pre-join and post-leave sessions are never shared (9, 19);
  - offline, group screens show an offline marker and the last fetched data; group writes need a connection (10);
  - member identity is the username only, and usernames stay non-unique (11, C7.1);
  - former members stay in the record, and rejoining restores them as a current member (13);
  - gym names are visible to the group; GPS is never shared (15);
  - a session is shared at start, keeps updating until complete, and later edits and deletes flow through (16–18);
  - the stream shows one collapsed card per session, newest start time first (20);
  - an in-progress session shows "Training now" for as long as it is active, with no staleness cutoff (C7.2);
  - removal shows as "X was removed", and leaving as "X left the group" (C7.3);
  - only the owner and admins can see and share the invite code (C7.4).
