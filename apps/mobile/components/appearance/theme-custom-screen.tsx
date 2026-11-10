import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type ColorSchemeName } from 'react-native';

import {
  appearanceRoles,
  CUSTOM_PART_LABELS,
  previewMode,
  readIntendedAppearance,
  usePhoneScheme,
} from '@/components/appearance/chosen-theme';
import { applyingHeaderRight } from '@/components/appearance/theme-header';
import { PartSpotlight, ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { FormSection, HeaderTitleMenu, Notice, Screen, SliderRow, SwitchRow, uiBorder, uiGeometry, uiSpace, useUiRoles } from '@/components/ui';
import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import {
  BORDER_CONTRAST_MAX,
  CUSTOM_PARTS,
  customSeed,
  DEPTH_MAX,
  gamutColour,
  INK_RANGE,
  inkDefault,
  LIGHTNESS_MAX,
  LIGHTNESS_STEP,
  PAGE_DEFAULT,
  PAGE_RANGE,
  rampStrongest,
  STRENGTH_MAX,
  TEXT_CONTRAST_MAX,
  type CustomColours,
  type CustomPart,
  type HueStrength,
} from '@/components/ui/theme-custom';
import { hueName } from '@/components/ui/theme-hue';
import { startingCustom, type AppearanceChoice } from '@/components/ui/theme-presets';

type Draft = CustomColours[CustomPart];
// A slider's field of a part.
type Field = 'hue' | 'strength' | 'lightness' | 'depth' | 'contrast';

const percent = (value: number): string => `${value}%`;
const HUE_MAX = 359;
const HUE_SEGMENTS = 36;
// What a hue gives a part at full strength: the borders paint as the
// background, the charts at their strongest step's L*.
const paintAt = (part: CustomPart, hue: number): string =>
  part === 'viz' ? gamutColour(rampStrongest, { hue, strength: STRENGTH_MAX }) : customSeed(part, { hue, strength: STRENGTH_MAX });
// The hue bar's paint for each part: each segment the colour its hue gives at
// full strength, so the bar shows what each hue can reach (some lose chroma).
// Computed once, not on every drag move.
const HUE_PAINT = Object.fromEntries(
  CUSTOM_PARTS.map((part) => [
    part,
    Array.from({ length: HUE_SEGMENTS }, (_, index) => paintAt(part, ((index + 0.5) * (HUE_MAX + 1)) / HUE_SEGMENTS)),
  ]),
) as Record<CustomPart, string[]>;
// The role that stands for a part: what the hue bar's swatch shows, in the
// theme being made.
const PART_ROLE: Record<CustomPart, keyof UiRoles> = {
  background: 'paper',
  borders: 'rule',
  ink: 'ink',
  text: 'inkMuted',
  accent: 'accent',
  record: 'record',
  viz: 'viz4',
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
// once (a switch), and the hue bar's swatch.
type Controls = {
  part: CustomPart;
  colours: CustomColours;
  change: (field: Field) => (value: number) => void;
  end: (field: Field) => (value: number) => void;
  save: (patch: Partial<CustomColours>) => void;
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
        trackColours={HUE_PAINT[part]}
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
// depth. Switching the mode puts the page and the primary text at that
// ladder's defaults.
function BackgroundControls(controls: Controls) {
  const { colours, change, end, save } = controls;
  const { background } = colours;
  const switchMode = (dark: boolean) => {
    const mode: ThemeMode = dark ? 'dark' : 'light';
    save({
      background: { ...background, mode, lightness: PAGE_DEFAULT[mode] },
      ink: { ...colours.ink, lightness: inkDefault(mode) },
    });
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
    </>
  );
}

// The hairlines: matching the page or a hue and strength of their own, and
// how far they step from the page. Unmatching starts from the page's colour,
// so nothing jumps.
function BordersControls(controls: Controls) {
  const { colours, change, end, save } = controls;
  const { borders, background } = colours;
  const match = (on: boolean) =>
    save({ borders: on ? { ...borders, match: true } : { ...borders, match: false, hue: background.hue, strength: background.strength } });
  return (
    <>
      <SwitchRow density="list" label="Match background" onValueChange={match} testID="theme-custom-match" value={borders.match} />
      {borders.match ? null : <HueStrengthRows {...controls} colour={borders} divider />}
      <SliderRow
        divider
        format={percent}
        label="Contrast"
        max={BORDER_CONTRAST_MAX}
        onChange={change('contrast')}
        onChangeEnd={end('contrast')}
        testID="theme-custom-contrast"
        value={borders.contrast}
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

function PartControls(controls: Controls) {
  switch (controls.part) {
    case 'background':
      return <BackgroundControls {...controls} />;
    case 'borders':
      return <BordersControls {...controls} />;
    case 'ink':
      return <InkControls {...controls} />;
    case 'text':
      return <TextControls {...controls} />;
    default:
      return <HueStrengthRows {...controls} colour={controls.colours[controls.part]} divider={false} />;
  }
}

// A part with one field moved. An edit of the charts draws them on the gamut:
// a strength is then a share of the most chroma each step holds (a theme
// saved before keeps the shipped ramp until then).
const editOf = (part: CustomPart, draft: Draft, field: Field, value: number): Draft =>
  ({ ...draft, [field]: value, ...(part === 'viz' ? { gamut: true } : {}) }) as Draft;

// Settings → Appearance → Custom → one part (background, borders, primary
// text, secondary text, accent, best ever, charts): a hue on a painted bar and
// a strength, and the part's own controls — the page's mode, lightness and
// depth; the borders' match and contrast; the texts' lightness or contrast.
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

  // `patch` holds the values let go at: the event is the truth, not the last
  // render.
  const save = async (patch: Partial<CustomColours>) => {
    const next = patch[part];
    if (next !== undefined) setDraft(next);
    // The colours the saves on their way will store, so another part's save
    // is not overwritten.
    const custom = { ...customOf(readIntendedAppearance(appearance), phoneScheme), ...patch };
    await commit(
      { theme: 'custom', custom },
      { message: 'Couldn’t save the colour. Nothing changed.', context: { part, value: Object.keys(patch).length === 1 && next !== undefined ? next : patch } },
    );
  };
  const controls: Controls = {
    part,
    colours,
    change: (field) => (value) => setDraft((current) => editOf(part, current, field, value)),
    end: (field) => (value) => {
      void save({ [part]: editOf(part, draft, field, value) });
    },
    save: (patch) => {
      void save(patch);
    },
    swatch: <View style={[styles.swatch, { backgroundColor: roles[PART_ROLE[part]], borderColor: liveRoles.rule }]} testID="theme-custom-hue-swatch" />,
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
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.control,
  },
});
