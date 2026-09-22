import fs from 'fs';
import path from 'path';

import appConfig from '../../app.config';
import { uiFonts } from '@/components/ui';

// A face whose name does not resolve falls back to the system font silently:
// nothing crashes and no Maestro lane reddens. These assertions are the
// infra-free half of the guard — `uiFonts` (what screens will name), the
// expo-font plugin entry (what the binary embeds) and the font files' own name
// tables (what the OS registers) must all agree. The on-device half is the
// render check recorded in the step-2 PR.

const APP_ROOT = path.resolve(__dirname, '../..');

type EmbeddedFace = { family: string; weight: number; file: string };

type FontPluginProps = {
  ios: { fonts: string[] };
  android: {
    fonts: {
      fontFamily: string;
      fontDefinitions: { path: string; weight: number }[];
    }[];
  };
};

// PostScript names read from the files with `fc-scan` (2026-09-22). iOS reads
// a face's weight from the PostScript suffix before its OS/2 weight class
// (`RCTGetFontWeight` in React Native's RCTFont.mm), so these suffixes are
// part of what makes `fontWeight` select the right face.
const EXPECTED_POSTSCRIPT_NAMES: Record<string, string> = {
  'Archivo 600': 'Archivo-SemiBold',
  'Archivo 700': 'Archivo-Bold',
  'Archivo 800': 'Archivo-ExtraBold',
  'Source Sans 3 400': 'SourceSans3-Regular',
  'Source Sans 3 600': 'SourceSans3-SemiBold',
  'IBM Plex Mono 500': 'IBMPlexMono-Medium',
  'IBM Plex Mono 600': 'IBMPlexMono-SemiBold',
  'IBM Plex Mono 700': 'IBMPlexMono-Bold',
};

function fontPluginProps(): FontPluginProps {
  const plugins: unknown[] = appConfig({ config: {} as never }).plugins;
  const entry = plugins.find(
    (plugin): plugin is [string, FontPluginProps] =>
      Array.isArray(plugin) && plugin[0] === 'expo-font',
  );
  if (!entry) {
    throw new Error('app.config.ts has no expo-font plugin entry');
  }
  return entry[1];
}

function tokenFaces(): { family: string; weight: number }[] {
  return Object.values(uiFonts).flatMap((font) =>
    font.weights.map((weight) => ({ family: font.family, weight: Number(weight) })),
  );
}

function embeddedFaces(props: FontPluginProps): EmbeddedFace[] {
  return props.android.fonts.flatMap((family) =>
    family.fontDefinitions.map((definition) => ({
      family: family.fontFamily,
      weight: definition.weight,
      file: definition.path,
    })),
  );
}

function faceKey(face: { family: string; weight: number }): string {
  return `${face.family} ${face.weight}`;
}

// Just enough of the sfnt format to read what the OS registers a face under:
// the Windows-platform English names and the OS/2 weight class.
function readFontFile(file: string): {
  typographicFamily: string;
  postscriptName: string;
  weightClass: number;
} {
  const buffer = fs.readFileSync(path.resolve(APP_ROOT, file));
  const tableCount = buffer.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    tables.set(buffer.toString('latin1', record, record + 4), buffer.readUInt32BE(record + 8));
  }

  const nameTable = tables.get('name');
  const os2Table = tables.get('OS/2');
  if (nameTable === undefined || os2Table === undefined) {
    throw new Error(`${file} has no name or OS/2 table`);
  }

  const names = new Map<number, string>();
  const nameCount = buffer.readUInt16BE(nameTable + 2);
  const stringStorage = nameTable + buffer.readUInt16BE(nameTable + 4);
  for (let index = 0; index < nameCount; index += 1) {
    const record = nameTable + 6 + index * 12;
    const platformId = buffer.readUInt16BE(record);
    const encodingId = buffer.readUInt16BE(record + 2);
    const languageId = buffer.readUInt16BE(record + 4);
    if (platformId !== 3 || encodingId !== 1 || languageId !== 0x409) {
      continue;
    }
    const start = stringStorage + buffer.readUInt16BE(record + 10);
    const utf16be = Buffer.from(buffer.subarray(start, start + buffer.readUInt16BE(record + 8)));
    names.set(buffer.readUInt16BE(record + 6), utf16be.swap16().toString('utf16le'));
  }

  return {
    // Name ID 16 when the family has more than the four legacy styles; the
    // Bold / Regular faces carry only name ID 1, which then is the family.
    typographicFamily: names.get(16) ?? names.get(1) ?? '',
    postscriptName: names.get(6) ?? '',
    weightClass: buffer.readUInt16BE(os2Table + 4),
  };
}

describe('the design-language typefaces are embedded under the names uiFonts uses', () => {
  const props = fontPluginProps();

  it('embeds every face uiFonts names, and nothing else, on Android', () => {
    expect(embeddedFaces(props).map(faceKey).sort()).toEqual(tokenFaces().map(faceKey).sort());
  });

  it('registers one Android font family per uiFonts family, under the same string', () => {
    expect(props.android.fonts.map((family) => family.fontFamily).sort()).toEqual(
      Object.values(uiFonts)
        .map((font) => font.family)
        .sort(),
    );
  });

  it('embeds the same files on iOS as on Android', () => {
    expect([...props.ios.fonts].sort()).toEqual(
      embeddedFaces(props)
        .map((face) => face.file)
        .sort(),
    );
  });

  it.each(embeddedFaces(props))('$family $weight is a real file registered under that name', (face) => {
    const font = readFontFile(face.file);
    // iOS groups embedded faces by this name, and RN picks among the group by
    // weight — so it has to be the family string screens pass as fontFamily.
    expect(font.typographicFamily).toBe(face.family);
    expect(font.weightClass).toBe(face.weight);
    expect(font.postscriptName).toBe(EXPECTED_POSTSCRIPT_NAMES[faceKey(face)]);
  });
});
