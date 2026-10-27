# Timer

### timer.rest-default · definition · accepted

An exercise may set its own rest timer (15–600 s, synced); blank uses the
global one. Rest started on that exercise's page uses it; the session overview
uses the global timer. A blank editor field shows the global value.

Code: `resolveRestTimerSec` in `apps/mobile/src/exercise-core/rest-timer.ts`.

### timer.set-tick · definition · accepted

Ticking a set complete restarts the rest timer. With auto-start off it
restarts a rest timer already showing and never starts one; a repeating timer
is left alone.

Code: `onSetConfirmed` in `apps/mobile/src/session-recorder/rest-timer.ts`.
