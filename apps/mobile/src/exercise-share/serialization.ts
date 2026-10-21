import { validateBodyweightContribution } from '@/src/exercise-core/bodyweight-contribution';
import { validateExerciseCore } from '@/src/exercise-core';

import type { ExerciseShareMuscleMapping, ExerciseSharePayload } from './types';

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const bytesToBase64Url = (bytes: Uint8Array): string => {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    result += BASE64URL_CHARS[b0 >> 2];
    result += BASE64URL_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < len) {
      result += BASE64URL_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
    }
    if (i + 2 < len) {
      result += BASE64URL_CHARS[b2 & 63];
    }
  }
  return result;
};

const BASE64URL_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64URL_CHARS.length; i++) {
  BASE64URL_LOOKUP[BASE64URL_CHARS.charCodeAt(i)] = i;
}

export const base64UrlToBytes = (str: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) return null;
  const len = str.length;
  if (len === 0) return new Uint8Array(0);

  const mod = len % 4;
  if (mod === 1) return null;

  const padding = mod === 0 ? 0 : 4 - mod;
  const totalLen = len + padding;
  const byteLen = (totalLen * 3) / 4 - padding;
  const bytes = new Uint8Array(byteLen);

  let byteIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = BASE64URL_LOOKUP[str.charCodeAt(i)];
    const c1 = i + 1 < len ? BASE64URL_LOOKUP[str.charCodeAt(i + 1)] : 0;
    const c2 = i + 2 < len ? BASE64URL_LOOKUP[str.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < len ? BASE64URL_LOOKUP[str.charCodeAt(i + 3)] : 0;

    bytes[byteIdx++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < len) {
      bytes[byteIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
    }
    if (i + 3 < len) {
      bytes[byteIdx++] = ((c2 & 3) << 6) | c3;
    }
  }
  return bytes;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeExerciseSharePayload = (payload: ExerciseSharePayload): string => {
  const json = JSON.stringify(payload);
  const bytes = textEncoder.encode(json);
  return bytesToBase64Url(bytes);
};

const VALID_ROLES = new Set(['primary', 'secondary', 'stabilizer']);

const validateMapping = (raw: unknown): ExerciseShareMuscleMapping | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.muscleGroupId !== 'string' || record.muscleGroupId.trim().length === 0) {
    return null;
  }
  if (typeof record.weight !== 'number' || !Number.isFinite(record.weight) || record.weight <= 0 || record.weight > 1) {
    return null;
  }
  let role: 'primary' | 'secondary' | 'stabilizer' | undefined = undefined;
  if (record.role !== undefined && record.role !== null) {
    if (typeof record.role !== 'string' || !VALID_ROLES.has(record.role)) {
      return null;
    }
    role = record.role as 'primary' | 'secondary' | 'stabilizer';
  }
  return {
    muscleGroupId: record.muscleGroupId.trim(),
    weight: record.weight,
    ...(role ? { role } : {}),
  };
};

export const decodeExerciseSharePayload = (encoded: string): ExerciseSharePayload | null => {
  if (typeof encoded !== 'string' || encoded.trim().length === 0) return null;
  const bytes = base64UrlToBytes(encoded.trim());
  if (!bytes) return null;

  try {
    const json = textDecoder.decode(bytes);
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return null;

    const coreValidation = validateExerciseCore({
      name: record.name,
      loadInputMode: record.loadInputMode,
    });
    if (!coreValidation.ok) return null;

    const bwValidation = validateBodyweightContribution(record.bodyweightContribution ?? 0);
    if (!bwValidation.ok) return null;

    if (!Array.isArray(record.mappings)) return null;
    const validatedMappings: ExerciseShareMuscleMapping[] = [];
    for (const rawMapping of record.mappings) {
      const mapping = validateMapping(rawMapping);
      if (!mapping) return null;
      validatedMappings.push(mapping);
    }

    return {
      v: 1,
      name: coreValidation.value.name,
      loadInputMode: coreValidation.value.loadInputMode,
      bodyweightContribution: bwValidation.value,
      mappings: validatedMappings,
    };
  } catch {
    return null;
  }
};
