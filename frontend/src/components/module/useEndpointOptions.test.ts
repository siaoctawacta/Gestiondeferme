import { describe, expect, it } from 'vitest';
import { resolveEndpointTemplate } from './useEndpointOptions';

describe('resolveEndpointTemplate', () => {
  it('puts the encoded parent value in the path', () => {
    expect(resolveEndpointTemplate({ endpoint: '/stock/{item}' }, 'item', 'a b')).toEqual({ endpoint: '/stock/a%20b' });
  });
  it('leaves an endpoint without a placeholder alone', () => {
    const def = { endpoint: '/zones' };
    expect(resolveEndpointTemplate(def, 'siteId', 's1')).toBe(def);
  });
  it('refuses a placeholder that is not the dependsOn field (configuration error)', () => {
    expect(() => resolveEndpointTemplate({ endpoint: '/stock/{item}' }, 'other', 'x')).toThrow(/\{item\}/);
    expect(() => resolveEndpointTemplate({ endpoint: '/stock/{item}' }, undefined, '')).toThrow(/\{item\}/);
  });
});
