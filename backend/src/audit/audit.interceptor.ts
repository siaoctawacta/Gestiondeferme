import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import type { RequestContext } from '../access/decorators';
import type { AuditAction } from '../generated/prisma/enums';
import { AuditService } from './audit.service';
import {
  AUDITED_KEY,
  AuditableService,
  AuditedMetadata,
} from './audited.decorator';

const ACTION_BY_METHOD: Record<string, AuditAction | undefined> = {
  POST: 'CREATE',
  PATCH: 'UPDATE',
  PUT: 'UPDATE',
  DELETE: 'DELETE',
};

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object'
    ? (v as Record<string, unknown>)
    : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly audit: AuditService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const meta = this.reflector.get<AuditedMetadata | undefined>(
      AUDITED_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<Request & { ctx?: RequestContext }>();
    const action = ACTION_BY_METHOD[req.method];
    const ctx = req.ctx;
    if (!action || !ctx) return next.handle();

    const routeId = str((req.params as Record<string, unknown>).id);
    const before =
      action !== 'CREATE' && routeId
        ? await this.loadBefore(meta, routeId, ctx)
        : undefined;

    // Only a response that completed is logged: errors skip mergeMap.
    return next
      .handle()
      .pipe(
        mergeMap((body: unknown) =>
          from(
            this.record(meta, action, ctx, routeId, before, body).then(
              (): unknown => body,
            ),
          ),
        ),
      );
  }

  private async loadBefore(
    meta: AuditedMetadata,
    id: string,
    ctx: RequestContext,
  ): Promise<unknown> {
    if (!meta.opts.entity) return undefined;
    try {
      const service = this.moduleRef.get<AuditableService>(meta.opts.entity, {
        strict: false,
      });
      return (await service.findForAudit(id, ctx)) ?? undefined;
    } catch (error) {
      this.logger.error(
        `Audit: could not load the previous state of ${meta.module}/${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return undefined;
    }
  }

  private async record(
    meta: AuditedMetadata,
    action: AuditAction,
    ctx: RequestContext,
    routeId: string | undefined,
    before: unknown,
    body: unknown,
  ): Promise<void> {
    try {
      const after = action === 'DELETE' ? undefined : body;
      const subject = action === 'DELETE' ? before : body;
      const recordId = action === 'DELETE' ? routeId : str(asRecord(body)?.id);
      await this.audit.log({
        ctx,
        module: meta.module,
        action,
        recordId: recordId ?? routeId,
        label: this.labelOf(meta, subject),
        before,
        after,
      });
    } catch (error) {
      // e.g. a user-supplied label() that throws; AuditService.log never throws itself.
      this.logger.error(
        `Audit: could not record ${meta.module}/${action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private labelOf(meta: AuditedMetadata, record: unknown): string | undefined {
    if (record === undefined || record === null) return undefined;
    if (meta.opts.label) return meta.opts.label(record);
    const r = asRecord(record);
    return str(r?.name) ?? str(r?.code) ?? str(r?.email);
  }
}
