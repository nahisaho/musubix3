// npm <= 11 prints an array; npm 12 prints an object keyed by package id.
export function firstPackEntry(raw) {
  const parsed = JSON.parse(raw);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed ?? {})[0];
  if (!entry) throw new Error('npm pack --json returned no package entry');
  return entry;
}
