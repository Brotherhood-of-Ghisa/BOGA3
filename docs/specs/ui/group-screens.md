# Group screens

> **Owns:** the group route inventory and the screen rules for group routes
> (`/group/*`, `/group-session/*`). **Not here:** the `/groups` tab, which
> `screen-map.md` owns, or the group rules (`../tech/groups-contract.md`).
> **Load when:** adding, removing, renaming or repurposing a group route, or
> changing a group screen's entry, exit or states.

## Routes

| Route | What it is for | File |
| --- | --- | --- |
| `/group/mine` | My groups: active memberships, `Join group` / `Create group` — the way into a group's management page | `group/mine.tsx` |
| `/group/new` | Create a group (inline username gate first when the username is blank) | `group/new.tsx` |
| `/group/join` | Join by code: code field, preview card, `Join group` | `group/join.tsx` |
| `/group/[groupId]` | The group screen, for *managing* the group: header, owner/admin Invite + Edit, CoW and meet previews, and the group's exercises with link / unlink. Stream and leaderboards live on `/groups` | `group/[groupId]/index.tsx` |
| `/group/[groupId]/meets` | Cached upcoming/past meets, online history paging and admin schedule entry | `group/[groupId]/meets/index.tsx` |
| `/group/[groupId]/meets/[meetId]` | Meet metadata, Maps, roster and online Join/Leave, member challenge editing and admin pre-start cancel | `group/[groupId]/meets/[meetId].tsx` |
| `/group/[groupId]/meets/schedule` | Admin schedule/edit, group-zone dates, permission-free address check and retained-input conflict recovery; ended metadata locked | `group/[groupId]/meets/schedule.tsx` |
| `/group/[groupId]/members` | The member list behind the header's member count, with role actions and `Leave group` | `group/[groupId]/members.tsx` |
| `/group/[groupId]/edit` | Owner/admin edit of name, description and group calendar time zone | `group/[groupId]/edit.tsx` |
| `/group/[groupId]/cows` | This week, next week and past CoWs; independent metric preview, online history and admin next-week entry | `group/[groupId]/cows/index.tsx` |
| `/group/[groupId]/cows/[cowId]` | Online full standings, server ranks/units and finality; metric switch replaces pages | `group/[groupId]/cows/[cowId].tsx` |
| `/group/[groupId]/cows/schedule` | Admin create/edit/cancel before start; fixed next week, active exercise picker, independent metric choices and uncertain-write recovery | `group/[groupId]/cows/schedule.tsx` |
| `/group/[groupId]/invite` | Owner/admin invite: the code, its `boga3://` link, Share, Regenerate | `group/[groupId]/invite.tsx` |
| `/group/[groupId]/exercises/new` | Owner/admin add a group exercise, `From catalogue` or `Custom` | `group/[groupId]/exercises/new.tsx` |
| `/group/[groupId]/exercises/[exerciseId]/edit` | Owner/admin rename a group exercise or change its weight entry | `group/[groupId]/exercises/[exerciseId]/edit.tsx` |
| `/group/[groupId]/leaderboards/[exerciseId]` | A group exercise's full board: tap-to-cycle metric and sets filters, ranked rows, row detail sheet; options menu: History, Exercise rules (admins) | `group/[groupId]/leaderboards/[exerciseId]/index.tsx` |
| `/group/[groupId]/leaderboards/[exerciseId]/history` | That board's records log, newest first, same filters: new bests and linked #1s (Certified: new #1s); rules changes divide, older entries dimmed | `group/[groupId]/leaderboards/[exerciseId]/history.tsx` |
| `/group-session/[memberId]/[sessionId]` | A member's shared session as the group sees it, drawn with View Session's cards, View Session's facts card (an `In progress` mark while it runs), its #1 group 1RM records (row → leaderboard); my own adds a full-session action | `group-session/[memberId]/[sessionId].tsx` |

## Screen rules

- A friend's session is read-only, with group #1 bands ([[set.row-figures]])
  and normalized `%BW` rows; ordinary cards
  retain permitted load.
- Invite codes and leaderboard rows are read **online only, never cached**; the
  group stream and the podiums are cached and render offline behind the offline
  marker, never showing an earlier week as if it were this one.
- One personal exercise links to **at most one exercise per group**, and
  archived group exercises are never offered as link targets.
- Group exercise add / rename / archive is owner/admin only, and a member sees
  an explicit refusal ("You can't add exercises") rather than a missing screen.
  Losing access (`NOT_FOUND`) replaces the screen with "no longer a member" and
  hides the cached data.
