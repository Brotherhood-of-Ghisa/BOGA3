# Timer

### timer.rest-default · definition · accepted

An exercise may set its own rest timer (15–600 s, synced); blank uses the
global one. Rest started on that exercise's page uses it; the session overview
uses the global timer. A blank editor field shows the global value.

Code: `resolveRestTimerSec` in `apps/mobile/src/exercise-core/rest-timer.ts`.

### timer.rest-alert · definition · accepted

A running rest timer sends one device-local completion alert with default sound,
subject to OS permission. Adjusting, dismissing, switching modes or completing
in the foreground cancels the scheduled alert.

Why: Lifters resting between sets need an alert without keeping the screen on.
Code: `scheduleRestTimerNotification` in `apps/mobile/src/session-recorder/rest-timer-notification-native.ts`.
