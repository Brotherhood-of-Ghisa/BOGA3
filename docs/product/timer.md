# Timer

### timer.repeating-cues · presentation · accepted

Repeating starts with 15 seconds' preparation. Every round, including Round 1,
has short beeps at −5…−1 seconds and a longer sixth beep at 0, without extending
the interval. Cues bypass silent mode, duck other audio during the sequence and
restore it afterwards. Pause silences cues and freezes fractional progress;
Resume never replays warnings. Reset/adjustment restart preparation, preserving
pause. Missed sounds are skipped; locked/background delivery is not guaranteed.

Code: `apps/mobile/src/session-recorder/rest-timer.ts`.

### timer.foreground-awake · presentation · accepted

Preparing/running repeating timers keep foreground BoGa awake, compact or
fullscreen. Pause, dismissal, mode switch, session end or backgrounding releases
it; Resume/foregrounding reacquires it if running. Collapse changes neither.
Manual lock/authentication remain intact; system power management can override.

Code: `apps/mobile/src/session-recorder/repeating-timer-native.ts`.
