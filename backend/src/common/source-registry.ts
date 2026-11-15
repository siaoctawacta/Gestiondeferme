import type { OnApplicationBootstrap } from '@nestjs/common';

/**
 * The inversion every cross-module seam uses: a module that must not import
 * another (`herd` never imports `pigs`, `feed` or `indicators`) owns a
 * registry, and the modules that provide something register a source in it.
 * A registry that cannot work without a source is `mandatory`: the application
 * refuses to start (naming the registry) when none registered, rather than
 * answering with silently missing data.
 */
export class SourceRegistry<T> implements OnApplicationBootstrap {
  private readonly sources: T[] = [];
  private readonly mandatory: boolean;

  constructor(
    readonly name: string,
    options: { mandatory?: boolean } = {},
  ) {
    this.mandatory = options.mandatory ?? false;
  }

  /** Registering the same source twice keeps one entry (a module may be re-initialised). */
  register(source: T): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  /** The sources, in registration order. */
  all(): T[] {
    return [...this.sources];
  }

  /** For a registry with exactly one provider: throws when there is none, or more than one. */
  single(): T {
    if (this.sources.length !== 1) {
      throw new Error(
        `Registre « ${this.name} » : un seul fournisseur est attendu, ${this.sources.length} enregistré(s)`,
      );
    }
    return this.sources[0];
  }

  onApplicationBootstrap(): void {
    if (this.mandatory && this.sources.length === 0) {
      throw new Error(
        `Registre « ${this.name} » : aucune source enregistrée (au moins une est obligatoire)`,
      );
    }
  }
}
