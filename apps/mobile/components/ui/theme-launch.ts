import { Storage } from 'expo-sqlite/kv-store';
import { Appearance, type ColorSchemeName } from 'react-native';

import type { ThemeMode } from '@/components/ui/theme';
import {
  appearanceMode,
  defaultTheme,
  resolveAppearance,
  resolveThemePreset,
  type AppearanceChoice,
  type ResolvedTheme,
} from '@/components/ui/theme-presets';
import {
  parseAppearanceRecord,
  parseLegacyAppearanceRecord,
  serialiseAppearanceRecord,
  type AppearanceRecordResult,
} from '@/components/ui/theme-record';


// The chosen appearance, per device: it is not synced to the account. Read
// synchronously, once, when `tokens.ts` first evaluates — about a hundred
// modules bake `uiRoles` into a module-scope `StyleSheet.create`, so a choice
// takes effect on the next launch (`docs/specs/ui/design-language.md` §2,
// "Choosing one").
//
// The record (`theme-record.ts`). Every save writes it.
export const APPEARANCE_STORAGE_KEY = 'boga3.appearance.v3';
// The two older values, read only while no newer one exists, never written,
// and left in place: the record before custom themes, and before it the accent
// id alone.
export const LEGACY_APPEARANCE_STORAGE_KEY = 'boga3.appearance.v2';
export const THEME_PRESET_STORAGE_KEY = 'boga3.themePreset.v1';

// The stored choice, resolved: the record, else the older record converted,
// else the accent id, else the default. An unusable value resolves to the
// default with its problem. Throws when the store cannot be read.
export function readStoredTheme(): ResolvedTheme {
  const record = Storage.getItemSync(APPEARANCE_STORAGE_KEY);
  if (record !== null) return resolveRecord(parseAppearanceRecord(record));
  const legacy = Storage.getItemSync(LEGACY_APPEARANCE_STORAGE_KEY);
  if (legacy !== null) return resolveRecord(parseLegacyAppearanceRecord(legacy, Appearance.getColorScheme()));
  return resolveThemePreset(Storage.getItemSync(THEME_PRESET_STORAGE_KEY));
}

const resolveRecord = (parsed: AppearanceRecordResult): ResolvedTheme =>
  parsed.appearance ? resolveAppearance(parsed.appearance) : defaultTheme(parsed.problem);

// What the stored choice resolves to, or the default and why.
export function readLaunchTheme(): ResolvedTheme {
  try {
    return readStoredTheme();
  } catch (error) {
    return defaultTheme({ kind: 'read-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

// The theme this launch is drawn in. Never changes while the app runs.
export const launchTheme: ResolvedTheme = readLaunchTheme();

// Reads the OS's mode, then pins the app's native UI (alerts, the date picker,
// the keyboard, the status bar's default) to the resolved mode (a custom
// theme's from its page) until the app
// is next launched, so an OS change while the app runs never mixes modes. The
// read must come first: once pinned, the OS reports the pin.
// `userInterfaceStyle: "automatic"` (`app.config.ts`) is what lets the read
// see a dark OS at all. A JS reload inside the same process (the dev
// client's reload) reads the previous pin, so it keeps that launch's mode;
// only a cold start reads the OS afresh.
export function pinLaunchMode(appearance: AppearanceChoice): { osScheme: ColorSchemeName | null; mode: ThemeMode } {
  const osScheme = Appearance.getColorScheme() ?? null;
  const resolved = appearanceMode(appearance, osScheme);
  // react-native-web's Appearance cannot pin; the web build has no native UI to pin.
  Appearance.setColorScheme?.(resolved);
  return { osScheme, mode: resolved };
}

// The OS's mode as this launch found it, and the mode this launch is drawn in.
// Resolved here, in the module `tokens.ts` evaluates first, so no module reads
// a role before the mode is fixed. Never changes while the app runs.
const launchPin = pinLaunchMode(launchTheme.appearance);
export const launchOsScheme: ColorSchemeName | null = launchPin.osScheme;
export const launchMode: ThemeMode = launchPin.mode;

const savedListeners = new Set<() => void>();

// Called after every successful save, so a row showing the stored choice
// (Settings home, Appearance) re-reads it when another page saved.
export function subscribeThemeSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

// Writes the whole choice as the record. Rejects when the write fails; the
// caller reports that nothing changed.
export async function saveAppearance(appearance: AppearanceChoice): Promise<void> {
  await Storage.setItem(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(appearance));
  savedListeners.forEach((listener) => listener());
}

let lastSave: Promise<void> = Promise.resolve();
// The saves accepted but not yet settled, so a second choice compares against
// what the first will store rather than what it has stored so far. Each field
// holds the value of the newest save that names it, and that save's ticket.
let queued: Partial<AppearanceChoice> = {};
const queuedTickets = new Map<keyof AppearanceChoice, number>();
let lastTicket = 0;

// The stored choice with the saves still queued applied. Throws when the store
// cannot be read.
export function readIntendedTheme(): AppearanceChoice {
  return { ...readStoredTheme().appearance, ...queued };
}

// Saves part of the choice — the theme, the mode, the custom colours —
// keeping the rest of the stored choice; an unusable stored choice is replaced by the default's. Saves run one
// after another, so two quick choices cannot overwrite each other's field.
// Rejects, saving nothing, when the store cannot be read or written.
export function saveAppearancePart(part: Partial<AppearanceChoice>): Promise<void> {
  const ticket = (lastTicket += 1);
  const fields = Object.keys(part) as (keyof AppearanceChoice)[];
  queued = { ...queued, ...part };
  fields.forEach((field) => queuedTickets.set(field, ticket));
  // A field leaves the queue when its newest save settles, saved or failed.
  const settle = (): void => {
    fields.forEach((field) => {
      if (queuedTickets.get(field) !== ticket) return;
      queuedTickets.delete(field);
      delete queued[field];
    });
  };
  const run = lastSave.then(() => saveAppearance({ ...readStoredTheme().appearance, ...part }));
  lastSave = run.then(settle, settle);
  return run;
}

