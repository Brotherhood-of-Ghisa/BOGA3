import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import appConfig from '../app.config';

jest.unmock('@/src/session-recorder/repeating-timer-native');
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn(), setIsAudioActiveAsync: jest.fn(),
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(), deactivateKeepAwake: jest.fn() }));

let native: typeof import('@/src/session-recorder/repeating-timer-native');
let short: { play: jest.Mock; pause: jest.Mock; seekTo: jest.Mock; remove: jest.Mock };
let long: typeof short;
const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  jest.resetAllMocks();
  short = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn() };
  long = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn() };
  jest.mocked(createAudioPlayer).mockReturnValueOnce(short as never).mockReturnValueOnce(long as never);
  jest.mocked(setAudioModeAsync).mockResolvedValue();
  jest.mocked(setIsAudioActiveAsync).mockResolvedValue();
  jest.mocked(activateKeepAwakeAsync).mockResolvedValue();
  jest.mocked(deactivateKeepAwake).mockResolvedValue();
  jest.isolateModules(() => { native = require('@/src/session-recorder/repeating-timer-native'); });
});

afterEach(async () => {
  native.stopRepeatingTimerAudio();
  native.setRepeatingTimerAwake(false);
  await flush();
  jest.useRealTimers();
});

it('preloads local tones once, bypasses silent mode, ducks for a sequence, then restores other audio', async () => {
  native.prepareRepeatingTimerAudio();
  native.prepareRepeatingTimerAudio();
  expect(createAudioPlayer).toHaveBeenCalledTimes(2);
  expect(createAudioPlayer).toHaveBeenLastCalledWith(expect.anything(), { keepAudioSessionActive: true, downloadFirst: true });
  for (let second = 0; second < 5; second++) {
    native.playRepeatingTimerCue('short', Date.now());
    await flush();
    expect(short.play).toHaveBeenCalledTimes(second + 1);
    await jest.advanceTimersByTimeAsync(1_000);
  }
  expect(setIsAudioActiveAsync).not.toHaveBeenCalledWith(false);
  native.playRepeatingTimerCue('long', Date.now());
  await flush();
  expect(long.play).toHaveBeenCalledTimes(1);
  expect(setAudioModeAsync).toHaveBeenLastCalledWith({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false, allowsRecording: false });
  await jest.advanceTimersByTimeAsync(650);
  expect(short.pause).toHaveBeenCalled();
  expect(long.pause).toHaveBeenCalled();
  expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
});

it.each(['mode', 'activation', 'seek'] as const)('cancels a cue waiting for native %s and restores audio afterwards', async (step) => {
  let finish!: () => void;
  const pending = new Promise<void>((resolvePending) => { finish = resolvePending; });
  if (step === 'mode') jest.mocked(setAudioModeAsync).mockReturnValueOnce(pending);
  if (step === 'activation') jest.mocked(setIsAudioActiveAsync).mockReturnValueOnce(pending);
  if (step === 'seek') short.seekTo.mockReturnValueOnce(pending);
  native.playRepeatingTimerCue('short', 0);
  await flush();
  native.stopRepeatingTimerAudio();
  finish();
  await flush();
  expect(short.play).not.toHaveBeenCalled();
  expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
  native.playRepeatingTimerCue('long', Date.now());
  await flush();
  expect(long.play).toHaveBeenCalledTimes(1);
});

it('drops a late native cue instead of replaying it', async () => {
  native.playRepeatingTimerCue('short', -1_000);
  await flush();
  expect(short.play).not.toHaveBeenCalled();
  expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
});

it('recovers after native playback failure without leaving music ducked', async () => {
  short.play.mockImplementationOnce(() => { throw new Error('Interrupted audio service'); });
  native.playRepeatingTimerCue('short', 0);
  await flush();
  expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
  native.playRepeatingTimerCue('long', 0);
  await flush();
  expect(long.play).toHaveBeenCalledTimes(1);
});

it('retries failed preload and releases a partially created player', () => {
  jest.mocked(createAudioPlayer).mockReset().mockReturnValueOnce(short as never).mockImplementationOnce(() => { throw new Error('Unavailable'); });
  native.prepareRepeatingTimerAudio();
  expect(short.remove).toHaveBeenCalledTimes(1);
  jest.mocked(createAudioPlayer).mockReturnValueOnce(short as never).mockReturnValueOnce(long as never);
  native.prepareRepeatingTimerAudio();
  expect(createAudioPlayer).toHaveBeenCalledTimes(4);
});

it('releases ducking if a later warning never arrives', async () => {
  native.playRepeatingTimerCue('short', 0);
  await flush();
  await jest.advanceTimersByTimeAsync(1_250);
  expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
});

it('uses one tag and orders delayed keep-awake activation before release and reacquisition', async () => {
  let finish!: () => void;
  jest.mocked(activateKeepAwakeAsync).mockReturnValueOnce(new Promise((resolvePending) => { finish = resolvePending; }));
  native.setRepeatingTimerAwake(true);
  native.setRepeatingTimerAwake(true);
  await flush();
  native.setRepeatingTimerAwake(false);
  native.setRepeatingTimerAwake(true);
  finish();
  await flush();
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
  expect(activateKeepAwakeAsync).toHaveBeenLastCalledWith('boga-repeating-timer');
  expect(deactivateKeepAwake).toHaveBeenLastCalledWith('boga-repeating-timer');
  native.setRepeatingTimerAwake(false);
  await flush();
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(2);
});

it('ships distinguishable 120ms and 650ms local PCM tones without recording/background permissions', () => {
  for (const [name, duration] of [['short', 0.12], ['long', 0.65]] as const) {
    const wav = readFileSync(resolve(__dirname, `../assets/audio/repeating-${name}.wav`));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(44_100);
    expect(wav.readUInt32LE(40) / (44_100 * 2)).toBeCloseTo(duration);
  }
  expect(appConfig({ config: {} as never }).plugins).toContainEqual(['expo-audio', {
    microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false, enableBackgroundRecording: false,
  }]);
});
