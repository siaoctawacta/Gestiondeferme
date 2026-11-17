import { describe, expect, it } from 'vitest';
import { isQrKind, qrEndpoint, qrPathOf } from './qr';

describe('qr helpers', () => {
  it('encodes the id in the lookup path', () => {
    expect(qrEndpoint('lot', 'a/b?c')).toBe('/qr/lot/a%2Fb%3Fc');
  });
  it('knows the five kinds only', () => {
    expect(['lot', 'animal', 'batiment', 'article', 'equipement'].every(isQrKind)).toBe(true);
    expect(isQrKind('users')).toBe(false);
    expect(isQrKind(undefined)).toBe(false);
  });
  it('accepts only a path of this origin', () => {
    expect(qrPathOf('/q/lot/x', 'http://a')).toBe('/q/lot/x');
    expect(qrPathOf('http://b/q/lot/x', 'http://a')).toBeNull();
  });
});
