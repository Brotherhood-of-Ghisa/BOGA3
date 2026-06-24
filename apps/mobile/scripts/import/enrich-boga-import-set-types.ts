#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import { validateBogaSessionImportPackage, type BogaSessionImportPackage } from './boga-import-contract';
import { enrichBogaImportSetTypes } from './set-type-enricher';

type CliFlags = {
  input?: string;
  output?: string;
  help: boolean;
};

const parseCliFlags = (argv: string[]): CliFlags => {
  const flags: CliFlags = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--input':
        flags.input = next();
        break;
      case '--output':
        flags.output = next();
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
};

const printHelp = () => {
  console.log(`BOGA import set-type enricher

Usage:
  npm run import:boga-json:enrich-set-types -- --input <boga-import.json> --output <enriched.json>
`);
};

const requireFlag = (value: string | undefined, label: string) => {
  if (!value || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
};

export const runBogaImportSetTypeEnricherCli = (argv: string[]) => {
  const flags = parseCliFlags(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const inputPath = requireFlag(flags.input, '--input');
  const outputPath = requireFlag(flags.output, '--output');
  if (!existsSync(inputPath)) {
    throw new Error(`Input BOGA import JSON not found: ${inputPath}`);
  }

  const parsed = JSON.parse(readFileSync(inputPath, 'utf8')) as BogaSessionImportPackage;
  const before = validateBogaSessionImportPackage(parsed);
  if (!before.ok) {
    throw new Error(`Input package is invalid:\n${before.errors.join('\n')}`);
  }

  const enriched = enrichBogaImportSetTypes(parsed);
  const after = validateBogaSessionImportPackage(enriched);
  if (!after.ok) {
    throw new Error(`Enriched package is invalid:\n${after.errors.join('\n')}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(enriched, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        input: inputPath,
        output: outputPath,
        sessions: enriched.sessions.length,
        exerciseSets: enriched.sessions.reduce(
          (sum, session) =>
            sum + session.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.sets.length, 0),
          0
        ),
      },
      null,
      2
    )
  );
  return 0;
};

if (require.main === module) {
  try {
    process.exitCode = runBogaImportSetTypeEnricherCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[boga-import-set-type-enricher] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
