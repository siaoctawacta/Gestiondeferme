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
  it('opens a /q/{kind}/{id} link whatever its origin, on the app path only', () => {
    expect(qrPathOf('/q/lot/x', 'http://a')).toBe('/q/lot/x');
    expect(qrPathOf('http://b/q/lot/x', 'http://a')).toBe('/q/lot/x');
    expect(qrPathOf('https://api.farm.example/q/equipement/e1?next=//evil', 'http://a')).toBe('/q/equipement/e1');
    expect(qrPathOf('  https://other/q/batiment/b%201 ', 'http://a')).toBe('/q/batiment/b%201');
  });
  it('refuses anything else than a known kind and an id under /q/', () => {
    for (const bad of ['', 'hello', 'http://b/m/lots/x', '/q/users/x', '/q/lot', '/q/lot/', '/q/lot/x/y', '/qq/lot/x', 'http://b/', '//evil.example/x']) {
      expect(qrPathOf(bad, 'http://a')).toBeNull();
    }
  });
});
