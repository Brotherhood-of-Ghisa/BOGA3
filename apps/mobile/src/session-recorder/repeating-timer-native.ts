import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'boga-repeating-timer';
let players: { short: AudioPlayer; long: AudioPlayer } | null = null;
let generation = 0;
let releaseTimeout: ReturnType<typeof setTimeout> | null = null;
let audioOperations = Promise.resolve();
let awakeOperations = Promise.resolve();
let awake = false;

export function prepareRepeatingTimerAudio(): void {
  if (players) return;
  try {
    const options = { keepAudioSessionActive: true, downloadFirst: true };
    const short = createAudioPlayer(require('../../assets/audio/repeating-short.wav'), options);
    try {
      players = { short, long: createAudioPlayer(require('../../assets/audio/repeating-long.wav'), options) };
    } catch {
      short.remove();
    }
  } catch {
    // Sound failure must never stop the shared clock; the next cue retries.
  }
}

export function stopRepeatingTimerAudio(): void {
  generation += 1;
  if (releaseTimeout !== null) clearTimeout(releaseTimeout);
  releaseTimeout = null;
  for (const player of Object.values(players ?? {})) {
    try { player.pause(); } catch { /* A reset native audio service may already have released it. */ }
  }
  // Serialize deactivation behind in-flight native calls so a late activation cannot retain ducking.
  audioOperations = audioOperations.then(() => setIsAudioActiveAsync(false)).catch(() => {});
}

export function playRepeatingTimerCue(kind: 'short' | 'long', targetMs: number): void {
  prepareRepeatingTimerAudio();
  const player = players?.[kind];
  if (!player) return;
  const token = ++generation;
  if (releaseTimeout !== null) clearTimeout(releaseTimeout);
  audioOperations = audioOperations.then(async () => {
    if (token !== generation) return;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false, allowsRecording: false });
      if (token !== generation) return;
      await setIsAudioActiveAsync(true);
      if (token !== generation) return;
      await player.seekTo(0);
      if (token !== generation) return;
      // A stalled native call must not play an obsolete warning or round-start sound.
      if (Date.now() - targetMs > 250) {
        stopRepeatingTimerAudio();
        return;
      }
      player.play();
      releaseTimeout = setTimeout(stopRepeatingTimerAudio, kind === 'long' ? 650 : 1_250);
    } catch {
      if (token === generation) stopRepeatingTimerAudio();
    }
  });
}

export function setRepeatingTimerAwake(next: boolean): void {
  if (awake === next) return;
  awake = next;
  // One tag and an ordered queue cover rapid Pause/Resume and delayed activation.
  awakeOperations = awakeOperations.then(() => next
    ? activateKeepAwakeAsync(KEEP_AWAKE_TAG)
    : deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => {});
}
