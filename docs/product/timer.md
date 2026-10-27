# Timer

### timer.rest-default · definition · accepted

An exercise may set its own rest timer (15–600 s, synced); blank uses the
global one. Rest started on that exercise's page uses it; the session overview
uses the global timer. A blank editor field shows the global value.

Code: `resolveRestTimerSec` in `apps/mobile/src/exercise-core/rest-timer.ts`.
