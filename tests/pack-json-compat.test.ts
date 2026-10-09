import { describe, expect, it } from 'vitest';
// @ts-expect-error plain mjs script helper
import { firstPackEntry } from '../scripts/pack-json.mjs';

describe('pack json compat', () => {
  it('reads npm<=11 array output', () => {
    expect(firstPackEntry('[{"filename":"a.tgz","files":[]}]').filename).toBe('a.tgz');
  });
  it('reads npm 12 object output', () => {
    expect(firstPackEntry('{"musubix3":{"filename":"b.tgz","files":[]}}').filename).toBe('b.tgz');
  });
  it('rejects empty output', () => {
    expect(() => firstPackEntry('[]')).toThrow(/no package entry/);
    expect(() => firstPackEntry('{}')).toThrow(/no package entry/);
  });
});
