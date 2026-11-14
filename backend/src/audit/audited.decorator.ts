import { SetMetadata, Type } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';

/** Implemented by services whose records are audited on update/delete (loads the "before" state). */
export interface AuditableService {
  findForAudit(id: string, ctx: RequestContext): Promise<unknown>;
}

export interface AuditedOptions {
  /** Human-readable name of the record; defaults to its `name`, `code` or `email`. */
  label?: (record: unknown) => string;
  /** Service used to load the record before an UPDATE/DELETE. Resolved through ModuleRef. */
  entity?: Type<AuditableService>;
}

export const AUDITED_KEY = 'audit:audited';

export interface AuditedMetadata {
  module: string;
  opts: AuditedOptions;
}

/** Opt-in: the global AuditInterceptor only logs routes carrying this decorator. */
export const Audited = (module: string, opts: AuditedOptions = {}) =>
  SetMetadata<string, AuditedMetadata>(AUDITED_KEY, { module, opts });
