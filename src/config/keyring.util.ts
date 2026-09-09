export const KID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface IParsedKeyring {
  keys: Record<string, string>;
  errors: string[];
}

export function parseKeyring({
  raw,
  validateValue,
}: {
  raw: string;
  validateValue: (value: string) => string | null;
}): IParsedKeyring {
  const keys: Record<string, string> = {};
  const errors: string[] = [];

  for (const entry of raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)) {
    const separatorIndex = entry.indexOf(':');

    if (separatorIndex === -1) {
      errors.push(`entry "${entry}" must be in "kid:value" format`);
      continue;
    }

    const kid = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (!KID_PATTERN.test(kid)) {
      errors.push(`key id "${kid}" is invalid (alphanumeric, - or _)`);
      continue;
    }

    const valueError = validateValue(value);

    if (valueError) {
      errors.push(`key for "${kid}" ${valueError}`);
      continue;
    }

    if (Object.hasOwn(keys, kid)) {
      errors.push(`duplicate key id "${kid}"`);
      continue;
    }

    keys[kid] = value;
  }

  if (Object.keys(keys).length === 0) {
    errors.push('at least one valid "kid:value" pair is required');
  }

  return { keys, errors };
}
