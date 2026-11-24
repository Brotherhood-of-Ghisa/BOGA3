import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type ColorSchemeName } from 'react-native';

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
import {
  FormSection,
  HeaderTitleMenu,
  Notice,
  RadioRow,
  Screen,
  SliderRow,
  SwitchRow,
  ValueRow,
  uiSpace,
  useUiText,
  useUiTextTone,
} from '@/components/ui';
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
  highlightOf,
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
  solidBars,
  STRENGTH_MAX,
  untinted,
  vividColour,
  washHighlight,
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
// The role that stands for a colour part: what its Colour row shows, in the
// theme being made.
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
// The hue bar: each segment its hue at its most vivid (`vividColour`), the
// same for every part, whatever its L*.
const HUE_PAINT: readonly string[] = Array.from({ length: HUE_SEGMENTS }, (_, index) =>
  vividColour(Math.round(((index + 0.5) * (HUE_MAX + 1)) / HUE_SEGMENTS)),
);
const RAMP_SEGMENTS = 24;
const ramp = (colourAt: (share: number) => string): string[] =>
  Array.from({ length: RAMP_SEGMENTS }, (_, index) => colourAt((index + 0.5) / RAMP_SEGMENTS));
// The strength bar: grey to the most the hue holds, at the colour's L*.
const strengthPaint = (lightness: number, hue: number): string[] =>
  ramp((share) => gamutColour(lightness, { hue, strength: share * STRENGTH_MAX }));
// The lightness bar: black to white, at the colour's hue and strength.
const lightnessPaint = (colour: HueStrength): string[] => ramp((share) => gamutColour(share * LIGHTNESS_MAX, colour));
const CHART_END_LABELS: Record<ChartEndName, string> = { start: 'Start', end: 'End' };
// The ramp step a chart end draws: what its Colour row shows.
const CHART_END_ROLE: Record<ChartEndName, keyof UiRoles> = { start: 'viz1', end: 'viz4' };
// What a failed save names, for a part that is not one colour.
const SAVE_NOUN: Partial<Record<CustomPart, string>> = { chart: 'chart', direction: 'direction' };
// What VoiceOver hears for a hue; the bar itself shows no words.
const hueLabel = (hue: number): string => `${hueName(hue)}, ${normaliseHue(hue)} degrees`;
const hueDegrees = (hue: number): string => `${normaliseHue(hue)}°`;
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
// and L* it draws (`gamutPart`); a highlight of its own at the L* it draws
// (`highlightOf`).
function partOf(colours: CustomColours, part: CustomPart): Draft {
  if (isOwnInkPart(part)) return ownInks(colours)[part];
  if (isTintedPart(part)) return gamutPart(colours, part);
  if (part === 'highlight') return highlightOf(colours);
  return part === 'chart' ? chartOf(colours) : colours[part];
}

// The moves that put a theme saved before on the gamut scale: a strength or a
// lightness, of any part.
const CONVERTING_FIELDS = new Set<Field>(['strength', 'lightness', 'start.strength', 'start.lightness', 'end.strength', 'end.lightness']);

// What a part's controls are given: the colours being made (the draft in
// place), a live and a let-go handler per slider, and a save of several parts
// at once (a switch) built on the colours the saves on their way will store.
type Controls = {
  part: CustomPart;
  colours: CustomColours;
  change: (field: Field) => (value: number) => void;
  end: (field: Field) => (value: number) => void;
  save: (patchOf: (intended: CustomColours) => Partial<CustomColours>) => void;
  // The theme being made, for the colour a part draws.
  roles: UiRoles;
};

// The colour picked, as the theme being made draws it: a wide swatch and its
// hex, so it reads apart from where the theme uses it.
function ColourRow({ colour, divider, label = 'Colour', testID }: { colour: string; divider: boolean; label?: string; testID: string }) {
  return (
    <ValueRow
      accessibilityLabel={`${label}, ${colour}`}
      divider={divider}
      label={label}
      testID={testID}
      value={colour}
      valueSwatch={colour}
      valueSwatchTestID={`${testID}-swatch`}
    />
  );
}

// A colour's three sliders' rows: its hue on a bar of every hue at its most
// vivid, its strength on a bar from grey to the most there, and (given) its
// L* on a bar from black to white — each bar painted at the colour's other
// values, so each shows where it goes. `lightness` is the L* the colour is
// drawn at; `lightnessValue` the lightness slider's (by default the same).
type ColourRowsProps = {
  colour: HueStrength;
  lightness: number;
  fields: { hue: Field; strength: Field; lightness?: Field };
  change: Controls['change'];
  end: Controls['end'];
  labels?: { hue: string; strength: string; lightness: string };
  testIDs?: { hue: string; strength: string; lightness: string };
  lightnessValue?: number;
};

const COLOUR_LABELS = { hue: 'Hue', strength: 'Strength', lightness: 'Lightness' };
const COLOUR_TEST_IDS = { hue: 'theme-custom-hue', strength: 'theme-custom-strength', lightness: 'theme-custom-lightness' };

function ColourSliders({ colour, lightness, fields, change, end, labels = COLOUR_LABELS, testIDs = COLOUR_TEST_IDS, lightnessValue = lightness }: ColourRowsProps) {
  const type = useUiText();
  const tone = useUiTextTone();
  const strengthTrack = useMemo(() => strengthPaint(lightness, colour.hue), [lightness, colour.hue]);
  const lightnessTrack = useMemo(() => lightnessPaint(colour), [colour]);
  const lightnessField = fields.lightness;
  return (
    <>
      <SliderRow
        divider
        format={hueLabel}
        label={labels.hue}
        max={HUE_MAX}
        onChange={change(fields.hue)}
        onChangeEnd={end(fields.hue)}
        testID={testIDs.hue}
        trackColours={HUE_PAINT}
        trailing={
          <Text accessibilityElementsHidden allowFontScaling={false} importantForAccessibility="no" style={[type.meta, tone.muted, styles.degrees]} testID={`${testIDs.hue}-degrees`}>
            {hueDegrees(colour.hue)}
          </Text>
        }
        // A drawn hue (unrounded) can lie just past 359.
        value={Math.min(colour.hue, HUE_MAX)}
      />
      <SliderRow
        divider
        format={percent}
        label={labels.strength}
        max={STRENGTH_MAX}
        onChange={change(fields.strength)}
        onChangeEnd={end(fields.strength)}
        testID={testIDs.strength}
        trackColours={strengthTrack}
        value={colour.strength}
      />
      {lightnessField === undefined ? null : (
        <SliderRow
          divider
          format={lightnessLabel}
          label={labels.lightness}
          max={LIGHTNESS_MAX}
          onChange={change(lightnessField)}
          onChangeEnd={end(lightnessField)}
          step={LIGHTNESS_STEP}
          testID={testIDs.lightness}
          trackColours={lightnessTrack}
          value={lightnessValue}
        />
      )}
    </>
  );
}

// The L* a colour part is drawn at: its role's.
const drawnLightness = (part: CustomColourPart, roles: UiRoles): number => hexToLch(roles[PART_ROLE[part]]).lightness;

// A colour part's Colour row and its sliders: hue, strength and, for every
// part but the highlight that matches, its lightness over the whole range.
function PartColour({ part, colour, lightness, controls, divider }: { part: CustomColourPart; colour: HueStrength; lightness: number; controls: Controls; divider: boolean }) {
  const { roles, change, end } = controls;
  return (
    <>
      <ColourRow colour={roles[PART_ROLE[part]]} divider={divider} testID="theme-custom-colour" />
      <ColourSliders
        change={change}
        colour={colour}
        end={end}
        fields={{ hue: 'hue', strength: 'strength', lightness: 'lightness' }}
        lightness={drawnLightness(part, roles)}
        lightnessValue={lightness}
      />
    </>
  );
}

// The page: its mode, its colour (lightness over the whole range), and depth
// and borders. Switching the mode puts the page, the inks, the chart's ends,
// the fills and the highlight at that ladder's defaults (`inksInMode`).
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
      highlight: washHighlight(intended.highlight),
    }));
  };
  return (
    <>
      <SwitchRow density="list" label="Dark" onValueChange={switchMode} testID="theme-custom-dark" value={background.mode === 'dark'} />
      <PartColour colour={background} controls={controls} divider lightness={background.lightness} part="background" />
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

// The highlight: matching the accent, a wash of it whose step from the page
// is its contrast; or a colour of its own, hue, strength and lightness over
// the whole range. Unmatching starts from the band the accent draws, so
// nothing jumps.
function HighlightControls(controls: Controls) {
  const { colours, change, end, save, roles } = controls;
  const { highlight } = colours;
  const match = (on: boolean) =>
    save((intended) => ({
      highlight: on
        ? { ...intended.highlight, match: true }
        : { ...washHighlight(intended.highlight), match: false, ...highlightFromAccent(accentSeed(intended), intended.background.mode) },
    }));
  return (
    <>
      <SwitchRow density="list" label="Match accent" onValueChange={match} testID="theme-custom-match" value={highlight.match} />
      {highlight.match ? (
        <>
          <ColourRow colour={roles.accentWash} divider testID="theme-custom-colour" />
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
      ) : (
        <PartColour colour={highlight} controls={controls} divider lightness={highlight.lightness ?? drawnLightness('highlight', roles)} part="highlight" />
      )}
    </>
  );
}

// Primary, secondary or muted text: its colour, its L* over the whole range,
// with no limit against the page or the other inks.
function InkControls(controls: Controls & { part: 'ink' | 'secondary' | 'muted'; colour: OwnInk }) {
  const { colour, part } = controls;
  return <PartColour colour={colour} controls={controls} divider={false} lightness={colour.lightness} part={part} />;
}

// The accent or best ever: its colour, its L* over the whole range, at the
// mode's by default (`fillLightness`).
function FillControls(controls: Controls & { part: FillPart }) {
  const { colours, part } = controls;
  return <PartColour colour={colours[part]} controls={controls} divider={false} lightness={fillLightness(colours, part)} part={part} />;
}

// One end of the chart's ramp: its Colour row, then its hue, strength and L*
// over the whole range.
function ChartEndRows({ change, end, roles, which, colour }: Controls & { which: ChartEndName; colour: ChartEnd }) {
  const name = CHART_END_LABELS[which];
  return (
    <>
      <ColourRow colour={roles[CHART_END_ROLE[which]]} divider label={`${name} colour`} testID={`theme-custom-${which}-colour`} />
      <ColourSliders
        change={change}
        colour={colour}
        end={end}
        fields={{ hue: `${which}.hue`, strength: `${which}.strength`, lightness: `${which}.lightness` }}
        labels={{ hue: `${name} hue`, strength: `${name} strength`, lightness: `${name} lightness` }}
        lightness={colour.lightness}
        testIDs={{ hue: `theme-custom-${which}-hue`, strength: `theme-custom-${which}-strength`, lightness: `theme-custom-${which}-lightness` }}
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
      return <InkControls {...controls} colour={controls.colours.ink} part="ink" />;
    case 'secondary':
    case 'muted': {
      const inks = ownInks(controls.colours);
      return <InkControls {...controls} colour={inks[controls.part]} part={controls.part} />;
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
// So does a highlight of its own let go where it draws.
function letGoPatch(intended: CustomColours, part: CustomPart, field: Field, value: number, draft: Draft): Partial<CustomColours> {
  const converting = !isGamutScaled(intended) && (CONVERTING_FIELDS.has(field) || leftTint(part, draft));
  const base = converting ? onGamutScale(intended) : intended;
  const edited = editOf(isGamutScaled(base) ? draft : storedBefore(part, draft), field, value);
  const conversion = converting ? base : {};
  // A highlight of its own let go where it draws, not yet at its own L*,
  // stores nothing new.
  if (part === 'highlight' && JSON.stringify(highlightOf(base)) === JSON.stringify(edited) && base.highlight.lightness === undefined) return conversion;
  if (!isOwnInkPart(part)) return { ...conversion, [part]: edited };
  const inks = ownInks(base);
  return JSON.stringify(inks[part]) === JSON.stringify(edited) ? conversion : { ...conversion, ...inks, [part]: edited };
}

// Settings → Appearance → Custom → one part (background, primary, secondary
// and muted text, accent, highlight, best ever): the colour picked (a
// swatch and its hex), its hue, strength and lightness over the whole gamut,
// and the part's own controls — the page's mode, depth and borders; the
// highlight's match, and its contrast while it matches.
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
    roles,
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
  degrees: {
    textAlign: 'right',
  },
});
