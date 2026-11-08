import { Storage } from 'expo-sqlite/kv-store';

import { readPhoneScheme } from '@/components/ui/theme-native';
import {
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
// synchronously when the theme provider (`theme-context.tsx`) first loads, and
// again after each save, which repaints the app
// (`docs/specs/ui/design-language.md` §2, "Choosing one").
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
  if (legacy !== null) return resolveRecord(parseLegacyAppearanceRecord(legacy, readPhoneScheme()));
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

// The stored choice as this launch found it: the theme the app first draws,
// and any problem that made it fall back to the default.
export const launchTheme: ResolvedTheme = readLaunchTheme();

const savedListeners = new Set<() => void>();

// Called after every successful save: the theme provider repaints the app, and
// a row showing the stored choice (Settings home, Appearance) re-reads it.
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

