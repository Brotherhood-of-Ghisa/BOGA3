import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
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
import {
  CUSTOM_COLOUR_PARTS,
  CUSTOM_PARTS,
  BORDERS_MAX,
  bordersOf,
  customSeed,
  DEPTH_MAX,
  HIGHLIGHT_CONTRAST_MAX,
  highlightFromAccent,
  INK_RANGE,
  inkDefault,
  LIGHTNESS_MAX,
  LIGHTNESS_STEP,
  PAGE_DEFAULT,
  isColourPart,
  PAGE_RANGE,
  STRENGTH_MAX,
  TEXT_CONTRAST_MAX,
  type CustomColourPart,
  type CustomColours,
  type CustomPart,
  type HueStrength,
} from '@/components/ui/theme-custom';
import { hueName } from '@/components/ui/theme-hue';
import { startingCustom, type AppearanceChoice } from '@/components/ui/theme-presets';

type Draft = CustomColours[CustomPart];
// A slider's field of a part.
type Field = 'hue' | 'strength' | 'lightness' | 'depth' | 'borders' | 'contrast';

const percent = (value: number): string => `${value}%`;
const HUE_MAX = 359;
const HUE_SEGMENTS = 36;
// The hue bar's paint for each colour part: each segment the colour its hue
// gives at full strength, so the bar shows what each hue can reach (some lose
// chroma). Computed once, not on every drag move.
const HUE_PAINT = Object.fromEntries(
  CUSTOM_COLOUR_PARTS.map((part) => [
    part,
    Array.from({ length: HUE_SEGMENTS }, (_, index) =>
      customSeed(part, { hue: ((index + 0.5) * (HUE_MAX + 1)) / HUE_SEGMENTS, strength: STRENGTH_MAX }),
    ),
  ]),
) as Record<CustomColourPart, string[]>;
// The role that stands for a colour part: what the hue bar's swatch shows, in
// the theme being made.
const PART_ROLE: Record<CustomColourPart, keyof UiRoles> = {
  background: 'paper',
  ink: 'ink',
  text: 'inkMuted',
  accent: 'accent',
  highlight: 'accentWash',
  record: 'record',
};
const PART_OPTIONS = CUSTOM_PARTS.map((id) => ({ id, label: CUSTOM_PART_LABELS[id] }));
// What VoiceOver hears for a hue; the bar itself shows no words.
const hueLabel = (hue: number): string => `${hueName(hue)}, ${hue} degrees`;
const lightnessLabel = (value: number): string => (value === 0 ? 'Black' : value === LIGHTNESS_MAX ? 'White' : `${value}`);

// The custom colours a choice draws, or the ones it would start from.
function customOf(appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): CustomColours {
  return startingCustom(appearance, previewMode(appearance, phoneScheme));
}

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
};

function HueStrengthRows({ change, end, swatch, part, colour, divider }: Controls & { colour: HueStrength; divider: boolean }) {
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
        trackColours={isColourPart(part) ? HUE_PAINT[part] : undefined}
        trailing={swatch}
        value={colour.hue}
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
// depth and borders. Switching the mode puts the page and the primary text at that
// ladder's defaults.
function BackgroundControls(controls: Controls) {
  const { colours, change, end, save } = controls;
  const { background } = colours;
  const switchMode = (dark: boolean) => {
    const mode: ThemeMode = dark ? 'dark' : 'light';
    save((intended) => ({
      background: { ...background, mode, lightness: PAGE_DEFAULT[mode] },
      ink: { ...intended.ink, lightness: inkDefault(mode) },
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
    save(({ accent, background }) => ({
      highlight: on ? { ...highlight, match: true } : { ...highlight, match: false, ...highlightFromAccent(customSeed('accent', accent), background.mode) },
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

// Secondary text: a hue and strength, and how far its inks step from the page.
function TextControls(controls: Controls) {
  const { colours, change, end } = controls;
  return (
    <>
      <HueStrengthRows {...controls} colour={colours.text} divider={false} />
      <SliderRow
        divider
        format={percent}
        label="Contrast"
        max={TEXT_CONTRAST_MAX}
        onChange={change('contrast')}
        onChangeEnd={end('contrast')}
        testID="theme-custom-contrast"
        value={colours.text.contrast}
      />
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
    case 'text':
      return <TextControls {...controls} />;
    case 'highlight':
      return <HighlightControls {...controls} />;
    default:
      return <HueStrengthRows {...controls} colour={controls.colours[controls.part]} divider={false} />;
  }
}

// A part with one field moved. Only a colour part has sliders; the direction
// is returned as it is. Moving the depth of a page that has no borders of its
// own pins them where they are, so the hairlines stay put.
const editOf = (draft: Draft, field: Field, value: number): Draft => {
  if (typeof draft === 'string') return draft;
  const pinned = field === 'depth' && 'depth' in draft && draft.borders === undefined && draft.depth !== value ? { borders: draft.depth } : {};
  return { ...draft, ...pinned, [field]: value } as Draft;
};

// Settings → Appearance → Custom → one part (background, primary text,
// secondary text, accent, highlight, best ever): a hue on a painted bar and
// a strength, and the part's own controls — the page's mode, lightness,
// depth and borders; the highlight's match and contrast; the texts' lightness or contrast.
// The direction's page offers its three choices instead.
// Then the part's roles alone (`PartSpotlight`) and the whole theme on a
// small mock, both live while a control is held. A part saves when a slider
// is let go (or a VoiceOver step is made) or a switch is flipped, and the app
// repaints in it; the header's indicator shows until it has. The title
// switches to another part in place.
export function ThemeCustomScreen({ part, onChoosePart }: { part: CustomPart; onChoosePart: (part: CustomPart) => void }) {
  const { appearance, saveError, commit, applying } = useAppearanceCommit();
  const phoneScheme = usePhoneScheme();
  const [draft, setDraft] = useState<Draft>(() => customOf(appearance, phoneScheme)[part]);
  const colours: CustomColours = { ...customOf(appearance, phoneScheme), [part]: draft };
  const chosen: AppearanceChoice = { ...appearance, theme: 'custom', custom: colours };
  const roles = appearanceRoles(chosen, phoneScheme);
  const liveRoles = useUiRoles();

  // `patchOf` is given the colours the saves on their way will store, so
  // another part's save is not overwritten; this part's values are the ones
  // let go at: the event is the truth, not the last render.
  const save = async (patchOf: (intended: CustomColours) => Partial<CustomColours>) => {
    const intended = customOf(readIntendedAppearance(appearance), phoneScheme);
    const patch = patchOf(intended);
    const next = patch[part];
    if (next !== undefined) setDraft(next);
    await commit(
      { theme: 'custom', custom: { ...intended, ...patch } },
      { message: `Couldn’t save the ${isColourPart(part) ? 'colour' : 'direction'}. Nothing changed.`, context: { part, value: patch } },
    );
  };
  const controls: Controls = {
    part,
    colours,
    change: (field) => (value) => setDraft((current) => editOf(current, field, value)),
    end: (field) => (value) => {
      void save(() => ({ [part]: editOf(draft, field, value) }));
    },
    save: (patchOf) => {
      void save(patchOf);
    },
    swatch: isColourPart(part) ? (
      <View style={[styles.swatch, { backgroundColor: roles[PART_ROLE[part]], ...uiHairline(liveRoles, { shape: 'control' }) }]} testID="theme-custom-hue-swatch" />
    ) : null,
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
        <PartSpotlight part={part} roles={roles} testID="theme-custom-spotlight" />
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
