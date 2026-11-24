import { Stack } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ColorSchemeName } from 'react-native';

import {
  appearanceRoles,
  CUSTOM_PART_LABELS,
  DIRECTION_LABELS,
  previewMode,
  readIntendedAppearance,
  usePhoneScheme,
} from '@/components/appearance/chosen-theme';
import { applyingHeaderRight } from '@/components/appearance/theme-header';
import { PartSpotlight, ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { FormSection, HeaderTitleMenu, Notice, RadioRow, Screen, SliderRow, SwitchRow, uiGeometry, uiHairline, uiSpace, useUiRoles } from '@/components/ui';
import { THEME_DIRECTIONS, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import { hexToLch } from '@/components/ui/lch';
import {
  accentSeed,
  CUSTOM_PARTS,
  BORDERS_MAX,
  bordersOf,
  chartInMode,
  chartOf,
  drawnEnds,
  DEPTH_MAX,
  fillLightness,
  fillsInMode,
  gamutColour,
  gamutPart,
  HIGHLIGHT_CONTRAST_MAX,
  highlightFromAccent,
  INK_RANGE,
  inkDefault,
  inksInMode,
  isGamutScaled,
  isOwnInkPart,
  isTintedPart,
  LIGHTNESS_MAX,
  LIGHTNESS_STEP,
  onGamutScale,
  ownInks,
  PAGE_DEFAULT,
  isColourPart,
  PAGE_RANGE,
  solidBars,
  STRENGTH_MAX,
  untinted,
  type ChartEnd,
  type CustomColourPart,
  type CustomColours,
  type CustomFill,
  type CustomPart,
  type FillPart,
  type HueStrength,
  type OwnInk,
} from '@/components/ui/theme-custom';
import { hueName, normaliseHue } from '@/components/ui/theme-hue';
import { startingCustom, type AppearanceChoice } from '@/components/ui/theme-presets';

type Draft = NonNullable<CustomColours[CustomPart]>;
// A slider's field of a part; a chart end's as `start.hue`.
type ColourField = 'hue' | 'strength' | 'lightness';
type ChartEndName = 'start' | 'end';
type Field = ColourField | 'depth' | 'borders' | 'contrast' | `${ChartEndName}.${ColourField}`;

// The secondary and the muted text store unrounded values (`OwnInk`): shown
// whole.
const percent = (value: number): string => `${Math.round(value)}%`;
const HUE_MAX = 359;
const HUE_SEGMENTS = 36;
// The role that stands for a colour part: what the hue bar's swatch shows, in
// the theme being made.
const PART_ROLE: Record<CustomColourPart, keyof UiRoles> = {
  background: 'paper',
  ink: 'ink',
  secondary: 'inkMuted',
  muted: 'inkFaint',
  accent: 'accent',
  highlight: 'accentWash',
  record: 'record',
};
const PART_OPTIONS = CUSTOM_PARTS.map((id) => ({ id, label: CUSTOM_PART_LABELS[id] }));
// A hue bar: each segment the colour its hue gives at full strength at the
// part's L*, so the bar shows what each hue can reach there.
const huePaint = (lightness: number): string[] =>
  Array.from({ length: HUE_SEGMENTS }, (_, index) =>
    gamutColour(lightness, { hue: ((index + 0.5) * (HUE_MAX + 1)) / HUE_SEGMENTS, strength: STRENGTH_MAX }),
  );
const CHART_END_LABELS: Record<ChartEndName, string> = { start: 'Start', end: 'End' };
// The ramp step a chart end draws: what its hue bar's swatch shows.
const CHART_END_ROLE: Record<ChartEndName, keyof UiRoles> = { start: 'viz1', end: 'viz4' };
// What a failed save names, for a part that is not one colour.
const SAVE_NOUN: Partial<Record<CustomPart, string>> = { chart: 'chart', direction: 'direction' };
// What VoiceOver hears for a hue; the bar itself shows no words.
const hueLabel = (hue: number): string => `${hueName(hue)}, ${normaliseHue(hue)} degrees`;
const lightnessLabel = (value: number): string =>
  value === 0 ? 'Black' : value === LIGHTNESS_MAX ? 'White' : `${Math.round(value / LIGHTNESS_STEP) * LIGHTNESS_STEP}`;

// The custom colours a choice draws, or the ones it would start from.
function customOf(appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): CustomColours {
  return startingCustom(appearance, previewMode(appearance, phoneScheme));
}

// The colours a part's page shows, on the gamut scale (`onGamutScale`: what a
// theme saved before draws, unchanged): the secondary's and the muted text's
// pages show both at their own L*, as the theme draws them now (`ownInks`).
const shownFor = (part: CustomPart, stored: CustomColours): CustomColours => {
  const colours = onGamutScale(stored);
  return isOwnInkPart(part) ? { ...colours, ...ownInks(colours) } : colours;
};

// A part's value; the secondary's or muted text's, and the chart's, as drawn
// when not yet stored; a tinted page, accent or best ever at the strength
// and L* it draws (`gamutPart`).
function partOf(colours: CustomColours, part: CustomPart): Draft {
  if (isOwnInkPart(part)) return ownInks(colours)[part];
  if (isTintedPart(part)) return gamutPart(colours, part);
  return part === 'chart' ? chartOf(colours) : colours[part];
}

// The moves that put a theme saved before on the gamut scale: a strength or a
// lightness, of any part.
const CONVERTING_FIELDS = new Set<Field>(['strength', 'lightness', 'start.strength', 'start.lightness', 'end.strength', 'end.lightness']);

// What a part's controls are given: the colours being made (the draft in
// place), a live and a let-go handler per slider, a save of several parts at
// once (a switch) built on the colours the saves on their way will store, and
// the hue bar's swatch (none for the direction).
type Controls = {
  part: CustomPart;
  colours: CustomColours;
  change: (field: Field) => (value: number) => void;
  end: (field: Field) => (value: number) => void;
  save: (patchOf: (intended: CustomColours) => Partial<CustomColours>) => void;
  swatch: ReactNode;
  // The theme being made, for a swatch a part draws itself (the chart's ends),
  // and the live one, for its hairline.
  roles: UiRoles;
  liveRoles: UiRoles;
};

// The L* a colour part's hue bar is painted at: its role's, as drawn.
const paintLightness = (part: CustomPart, roles: UiRoles): number | null => (isColourPart(part) ? hexToLch(roles[PART_ROLE[part]]).lightness : null);

function HueStrengthRows({ change, end, swatch, part, colour, divider, roles }: Controls & { colour: HueStrength; divider: boolean }) {
  const at = paintLightness(part, roles);
  const paint = useMemo(() => (at === null ? undefined : huePaint(at)), [at]);
  return (
    <>
      <SliderRow
        divider={divider}
        format={hueLabel}
        label="Hue"
        max={HUE_MAX}
        onChange={change('hue')}
        onChangeEnd={end('hue')}
        testID="theme-custom-hue"
        trackColours={paint}
        trailing={swatch}
        // A drawn hue (unrounded) can lie just past 359.
        value={Math.min(colour.hue, HUE_MAX)}
      />
      <SliderRow
        divider
        format={percent}
        label="Strength"
        max={STRENGTH_MAX}
        onChange={change('strength')}
        onChangeEnd={end('strength')}
        testID="theme-custom-strength"
        value={colour.strength}
      />
    </>
  );
}

// The page: its mode, hue and strength, lightness over the mode's range, and
// depth and borders. Switching the mode puts the page and the inks at that
// ladder's defaults (`inksInMode`).
function BackgroundControls(controls: Controls) {
  const { colours, change, end, save } = controls;
  const { background } = colours;
  const switchMode = (dark: boolean) => {
    const mode: ThemeMode = dark ? 'dark' : 'light';
    save((intended) => ({
      background: { ...intended.background, mode, lightness: PAGE_DEFAULT[mode] },
      ink: { ...intended.ink, lightness: inkDefault(mode) },
      ...inksInMode(intended, mode),
      ...chartInMode(intended, mode),
      ...fillsInMode(intended, mode),
    }));
  };
  const range = PAGE_RANGE[background.mode];
  return (
    <>
      <SwitchRow density="list" label="Dark" onValueChange={switchMode} testID="theme-custom-dark" value={background.mode === 'dark'} />
      <HueStrengthRows {...controls} colour={background} divider />
      <SliderRow
        divider
        format={lightnessLabel}
        label="Lightness"
        max={range.max}
        min={range.min}
        onChange={change('lightness')}
        onChangeEnd={end('lightness')}
        step={LIGHTNESS_STEP}
        testID="theme-custom-lightness"
        value={background.lightness}
      />
      <SliderRow
        divider
        format={percent}
        label="Depth"
        max={DEPTH_MAX}
        onChange={change('depth')}
        onChangeEnd={end('depth')}
        testID="theme-custom-depth"
        value={background.depth}
      />
      <SliderRow
        divider
        format={percent}
        label="Borders"
        max={BORDERS_MAX}
        onChange={change('borders')}
        onChangeEnd={end('borders')}
        testID="theme-custom-borders"
        value={bordersOf(background)}
      />
    </>
  );
}

// The highlight: matching the accent or a hue and strength of its own, and
// how far it steps from the page. Unmatching starts from the band the accent
// draws, so nothing jumps.
function HighlightControls(controls: Controls) {
  const { colours, change, end, save } = controls;
  const { highlight } = colours;
  const match = (on: boolean) =>
    save((intended) => ({
      highlight: on ? { ...highlight, match: true } : { ...highlight, match: false, ...highlightFromAccent(accentSeed(intended), intended.background.mode) },
    }));
  return (
    <>
      <SwitchRow density="list" label="Match accent" onValueChange={match} testID="theme-custom-match" value={highlight.match} />
      {highlight.match ? null : <HueStrengthRows {...controls} colour={highlight} divider />}
      <SliderRow
        divider
        format={percent}
        label="Contrast"
        max={HIGHLIGHT_CONTRAST_MAX}
        onChange={change('contrast')}
        onChangeEnd={end('contrast')}
        testID="theme-custom-contrast"
        value={highlight.contrast}
      />
    </>
  );
}

// Primary text: a hue and strength, and its L* over its mode's range.
function InkControls(controls: Controls) {
  const { colours, change, end } = controls;
  const range = INK_RANGE[colours.background.mode];
  return (
    <>
      <HueStrengthRows {...controls} colour={colours.ink} divider={false} />
      <SliderRow
        divider
        format={lightnessLabel}
        label="Lightness"
        max={range.max}
        min={range.min}
        onChange={change('lightness')}
        onChangeEnd={end('lightness')}
        step={LIGHTNESS_STEP}
        testID="theme-custom-lightness"
        value={colours.ink.lightness}
      />
    </>
  );
}

// Secondary or muted text: a hue and strength, and its L* over the whole
// range, with no limit against the other inks.
function OwnInkControls(controls: Controls & { colour: OwnInk }) {
  const { colour, change, end } = controls;
  return (
    <>
      <HueStrengthRows {...controls} colour={colour} divider={false} />
      <SliderRow
        divider
        format={lightnessLabel}
        label="Lightness"
        max={LIGHTNESS_MAX}
        onChange={change('lightness')}
        onChangeEnd={end('lightness')}
        step={LIGHTNESS_STEP}
        testID="theme-custom-lightness"
        value={colour.lightness}
      />
    </>
  );
}

// The accent or best ever: a hue and strength, and its L* over the whole
// range, at the mode's by default (`fillLightness`).
function FillControls(controls: Controls & { part: FillPart }) {
  const { colours, change, end, part } = controls;
  const colour = colours[part];
  return (
    <>
      <HueStrengthRows {...controls} colour={colour} divider={false} />
      <SliderRow
        divider
        format={lightnessLabel}
        label="Lightness"
        max={LIGHTNESS_MAX}
        onChange={change('lightness')}
        onChangeEnd={end('lightness')}
        step={LIGHTNESS_STEP}
        testID="theme-custom-lightness"
        value={fillLightness(colours, part)}
      />
    </>
  );
}

// One end of the chart's ramp: a hue on a bar painted at its L*, a strength
// and its L* over the whole range.
function ChartEndRows({ change, end, roles, liveRoles, which, colour }: Controls & { which: ChartEndName; colour: ChartEnd }) {
  const paint = useMemo(() => huePaint(colour.lightness), [colour.lightness]);
  const name = CHART_END_LABELS[which];
  return (
    <>
      <SliderRow
        divider
        format={hueLabel}
        label={`${name} hue`}
        max={HUE_MAX}
        onChange={change(`${which}.hue`)}
        onChangeEnd={end(`${which}.hue`)}
        testID={`theme-custom-${which}-hue`}
        trackColours={paint}
        trailing={
          <View
            style={[styles.swatch, { backgroundColor: roles[CHART_END_ROLE[which]], ...uiHairline(liveRoles, { shape: 'control' }) }]}
            testID={`theme-custom-${which}-swatch`}
          />
        }
        // A drawn hue (unrounded) can lie just past 359.
        value={Math.min(colour.hue, HUE_MAX)}
      />
      <SliderRow
        divider
        format={percent}
        label={`${name} strength`}
        max={STRENGTH_MAX}
        onChange={change(`${which}.strength`)}
        onChangeEnd={end(`${which}.strength`)}
        testID={`theme-custom-${which}-strength`}
        value={colour.strength}
      />
      <SliderRow
        divider
        format={lightnessLabel}
        label={`${name} lightness`}
        max={LIGHTNESS_MAX}
        onChange={change(`${which}.lightness`)}
        onChangeEnd={end(`${which}.lightness`)}
        step={LIGHTNESS_STEP}
        testID={`theme-custom-${which}-lightness`}
        value={colour.lightness}
      />
    </>
  );
}

// The chart: its ramp following the page, or from a start to an end of the
// user's; and solid bars. Leaving the page's ramp starts from its ends as
// drawn, so neither end moves.
function ChartControls(controls: Controls) {
  const { colours, save } = controls;
  const chart = chartOf(colours);
  const follow = (on: boolean) => save((intended) => ({ chart: { ...chartOf(intended), follow: on, ...(on ? {} : drawnEnds(intended)) } }));
  const solid = (on: boolean) => save((intended) => ({ chart: { ...chartOf(intended), solid: on } }));
  return (
    <>
      <SwitchRow density="list" label="Follow background" onValueChange={follow} testID="theme-custom-follow" value={chart.follow} />
      {chart.follow ? null : (
        <>
          <ChartEndRows {...controls} colour={chart.start} which="start" />
          <ChartEndRows {...controls} colour={chart.end} which="end" />
        </>
      )}
      <SwitchRow density="list" divider label="Solid bars" onValueChange={solid} testID="theme-custom-solid" value={chart.solid} />
    </>
  );
}

// The direction a change is drawn in: one of three, saved on a tap.
function DirectionControls({ colours, save }: Controls) {
  return (
    <>
      {THEME_DIRECTIONS.map((direction, index) => (
        <RadioRow
          checked={colours.direction === direction}
          divider={index > 0}
          key={direction}
          label={DIRECTION_LABELS[direction]}
          onPress={() => save(() => ({ direction }))}
          testID={`theme-custom-direction-${direction}`}
        />
      ))}
    </>
  );
}

function PartControls(controls: Controls) {
  switch (controls.part) {
    case 'background':
      return <BackgroundControls {...controls} />;
    case 'direction':
      return <DirectionControls {...controls} />;
    case 'ink':
      return <InkControls {...controls} />;
    case 'secondary':
    case 'muted': {
      const inks = ownInks(controls.colours);
      return <OwnInkControls {...controls} colour={inks[controls.part]} />;
    }
    case 'highlight':
      return <HighlightControls {...controls} />;
    case 'chart':
      return <ChartControls {...controls} />;
    case 'accent':
    case 'record':
      return <FillControls {...controls} part={controls.part} />;
  }
}

// A part with one field moved. Only a colour part and the chart have
// sliders; the direction is returned as it is. A chart end's field moves that
// end. Moving the depth of a page that has no borders of its own pins them
// where they are, so the hairlines stay put. Moving a tinted part's strength
// or lightness drops its tint (`untinted`).
const editOf = (draft: Draft, field: Field, value: number): Draft => {
  if (typeof draft === 'string') return draft;
  if ('follow' in draft) {
    const [which, colourField] = field.split('.') as [ChartEndName, ColourField];
    return { ...draft, [which]: { ...draft[which], [colourField]: value } };
  }
  const pinned = field === 'depth' && 'depth' in draft && draft.borders === undefined && draft.depth !== value ? { borders: draft.depth } : {};
  const edited = { ...draft, ...pinned, [field]: value } as Draft;
  return CONVERTING_FIELDS.has(field) ? untinted(edited as CustomFill) : edited;
};

// A draft as it shows while held: a tinted part whose hue moves at the
// strength and L* it draws at that hue (`gamutPart`), so its sliders do not
// jump when let go.
function liveEdit(shown: CustomColours, part: CustomPart, edited: Draft, field: Field): Draft {
  if (field !== 'hue' || !isTintedPart(part) || typeof edited === 'string' || !('tint' in edited) || edited.tint === undefined) return edited;
  return gamutPart({ ...shown, [part]: edited }, part);
}

// A tinted page, accent or best ever (`gamutPart`) as a theme saved before
// stores it: its tint its strength, and a fill with no L* of its own. Any
// other part is the same on both scales.
function storedBefore(part: CustomPart, draft: Draft): Draft {
  if (!isTintedPart(part) || typeof draft === 'string' || !('tint' in draft) || draft.tint === undefined) return draft;
  const { tint, ...rest } = draft;
  if (part === 'background') return { ...rest, strength: tint } as Draft;
  const { lightness: _lightness, ...fill } = rest as CustomFill;
  return { ...fill, strength: tint };
}

// Whether a draft of a page, accent or best ever has left its tint: a move
// of its strength or lightness that did not save.
const leftTint = (part: CustomPart, draft: Draft): boolean =>
  isTintedPart(part) && typeof draft !== 'string' && 'strength' in draft && (draft as CustomFill).tint === undefined;

// What letting a slider go stores: on a theme saved before, a move that
// converts it (or a draft that left its tint) stores the whole theme on the
// gamut scale (`onGamutScale`), and any other the field alone, as that theme
// stores it. A secondary or muted text let go as it is stored (or drawn),
// with the saves on their way, stores nothing new; otherwise both are stored.
function letGoPatch(intended: CustomColours, part: CustomPart, field: Field, value: number, draft: Draft): Partial<CustomColours> {
  const converting = !isGamutScaled(intended) && (CONVERTING_FIELDS.has(field) || leftTint(part, draft));
  const base = converting ? onGamutScale(intended) : intended;
  const edited = editOf(isGamutScaled(base) ? draft : storedBefore(part, draft), field, value);
  const conversion = converting ? base : {};
  if (!isOwnInkPart(part)) return { ...conversion, [part]: edited };
  const inks = ownInks(base);
  return JSON.stringify(inks[part]) === JSON.stringify(edited) ? conversion : { ...conversion, ...inks, [part]: edited };
}

// Settings → Appearance → Custom → one part (background, primary, secondary
// and muted text, accent, highlight, best ever): a hue on a painted bar and
// a strength, and the part's own controls — the page's mode, lightness,
// depth and borders; the highlight's match and contrast; the inks' lightness.
// The secondary and the muted text are stored together: the first move of
// either stores both as drawn (`ownInks`), so the other does not jump.
// The chart's page offers Follow background, the ramp's two ends when it does
// not, and Solid bars; the direction's its three choices.
// Then the part's roles alone (`PartSpotlight`) and the whole theme on a
// small mock, both live while a control is held. A part saves when a slider
// is let go (or a VoiceOver step is made) or a switch is flipped, and the app
// repaints in it; the header's indicator shows until it has. The title
// switches to another part in place.
export function ThemeCustomScreen({ part, onChoosePart }: { part: CustomPart; onChoosePart: (part: CustomPart) => void }) {
  const { appearance, saveError, commit, applying } = useAppearanceCommit();
  const phoneScheme = usePhoneScheme();
  // The colours as stored (with the inks as drawn on their pages); the draft
  // in place of this part while a control is held.
  const shown = useMemo(() => shownFor(part, customOf(appearance, phoneScheme)), [part, appearance, phoneScheme]);
  const [draft, setDraft] = useState<Draft>(() => partOf(shown, part));
  const colours: CustomColours = { ...shown, [part]: draft };
  const chosen: AppearanceChoice = { ...appearance, theme: 'custom', custom: colours };
  const roles = appearanceRoles(chosen, phoneScheme);
  const liveRoles = useUiRoles();

  // `patchOf` is given the colours the saves on their way will store, so
  // another part's save is not overwritten; this part's values are the ones
  // let go at: the event is the truth, not the last render.
  const save = async (patchOf: (intended: CustomColours) => Partial<CustomColours>) => {
    const intended = customOf(readIntendedAppearance(appearance), phoneScheme);
    const patch = patchOf(intended);
    if (patch[part] !== undefined) setDraft(partOf(shownFor(part, { ...intended, ...patch }), part));
    await commit(
      { theme: 'custom', custom: { ...intended, ...patch } },
      { message: `Couldn’t save the ${SAVE_NOUN[part] ?? 'colour'}. Nothing changed.`, context: { part, value: patch } },
    );
  };
  const controls: Controls = {
    part,
    colours,
    change: (field) => (value) => setDraft((current) => liveEdit(shown, part, editOf(current, field, value), field)),
    end: (field) => (value) => {
      void save((intended) => letGoPatch(intended, part, field, value, draft));
    },
    save: (patchOf) => {
      void save(patchOf);
    },
    swatch: isColourPart(part) ? (
      <View style={[styles.swatch, { backgroundColor: roles[PART_ROLE[part]], ...uiHairline(liveRoles, { shape: 'control' }) }]} testID="theme-custom-hue-swatch" />
    ) : null,
    roles,
    liveRoles,
  };

  return (
    <Screen testID="theme-custom-screen">
      <Stack.Screen
        options={{
          title: CUSTOM_PART_LABELS[part],
          headerTitle: () => (
            <HeaderTitleMenu currentId={part} onChoose={onChoosePart} options={PART_OPTIONS} sheetTitle="Colour" testID="theme-custom-title" />
          ),
          // Named either way: options merge across renders.
          headerRight: applyingHeaderRight(applying, 'theme-custom-applying'),
        }}
      />
      <View style={styles.body}>
        <FormSection>
          <PartControls {...controls} />
        </FormSection>
        <PartSpotlight part={part} roles={roles} solidBars={solidBars(colours)} testID="theme-custom-spotlight" />
        <ThemePreview roles={roles} testID="theme-custom-preview" />
        {saveError ? <Notice icon="warning" live message={saveError} testID="theme-custom-error" tone="danger" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: uiSpace.lg,
    padding: uiSpace.lg,
  },
  // The part's own role in the theme being made, on this page's ground.
  swatch: {
    width: uiGeometry.tapTarget / 2,
    height: uiGeometry.tapTarget / 2,
  },
});
