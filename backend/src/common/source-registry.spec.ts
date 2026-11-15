import { SourceRegistry } from './source-registry';

describe('SourceRegistry', () => {
  it('keeps sources in registration order, once each', () => {
    const registry = new SourceRegistry<{ n: number }>('test');
    const a = { n: 1 };
    const b = { n: 2 };
    registry.register(a);
    registry.register(b);
    registry.register(a);
    expect(registry.all()).toEqual([a, b]);
  });

  it('hands out a copy, so a caller cannot change the registry', () => {
    const registry = new SourceRegistry<number>('test');
    registry.register(1);
    registry.all().push(2);
    expect(registry.all()).toEqual([1]);
  });

  describe('single', () => {
    it('returns the only source', () => {
      const registry = new SourceRegistry<string>('test');
      registry.register('x');
      expect(registry.single()).toBe('x');
    });

    it('throws naming the registry when there is none', () => {
      expect(() => new SourceRegistry<string>('performance').single()).toThrow(
        'performance',
      );
    });

    it('throws when two different sources are registered', () => {
      const registry = new SourceRegistry<string>('performance');
      registry.register('a');
      registry.register('b');
      expect(() => registry.single()).toThrow('performance');
    });
  });

  describe('boot check', () => {
    it('fails naming the registry when a mandatory one has no source', () => {
      const registry = new SourceRegistry<string>('occupation', {
        mandatory: true,
      });
      expect(() => registry.onApplicationBootstrap()).toThrow('occupation');
    });

    it('passes once a source is registered', () => {
      const registry = new SourceRegistry<string>('occupation', {
        mandatory: true,
      });
      registry.register('x');
      expect(() => registry.onApplicationBootstrap()).not.toThrow();
    });

    it('does not require a source from an optional registry', () => {
      const registry = new SourceRegistry<string>('alerts');
      expect(() => registry.onApplicationBootstrap()).not.toThrow();
    });
  });
});
