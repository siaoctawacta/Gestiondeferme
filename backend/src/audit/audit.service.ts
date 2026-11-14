import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'totpSecretEnc',
  'backupCodes',
  'tokenHash',
]);

/** JSON-safe deep copy without the sensitive keys, at every depth. */
export function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    // Dates, Prisma Decimals...: they know how to serialise themselves; walking
    // their internals would leak implementation fields.
    const { toJSON } = value as { toJSON?: unknown };
    if (typeof toJSON === 'function') {
      const json: unknown = (toJSON as () => unknown).call(value);
      return json === value ? json : sanitize(json);
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key) || v === undefined) continue;
      out[key] = sanitize(v);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export interface AuditEntry {
  /** Present on authenticated routes; public routes pass the three fields below instead. */
  ctx?: RequestContext;
  userId?: string;
  userName?: string;
  organizationId?: string;
  farmId?: string | null;
  module: string;
  action: AuditAction;
  recordId?: string;
  label?: string;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Never throws: a failed audit write is logged server-side and must not break the request.
   * Pass `tx` to write the row inside the caller's transaction (it then commits
   * or rolls back with the change it describes).
   */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    try {
      const userId = entry.ctx?.user.id ?? entry.userId ?? null;
      const userName = entry.ctx?.user.name ?? entry.userName;
      const organizationId =
        entry.ctx?.user.organizationId ?? entry.organizationId;
      if (!userName || !organizationId) {
        throw new Error('audit entry needs a user name and an organisation');
      }
      const json = (v: unknown) => {
        const clean = sanitize(v);
        return clean === undefined || clean === null ? undefined : clean;
      };
      await (tx ?? this.prisma).auditLog.create({
        data: {
          organizationId,
          userId,
          userName,
          farmId: entry.farmId ?? entry.ctx?.farmId ?? null,
          module: entry.module,
          action: entry.action,
          recordId: entry.recordId ?? null,
          label: entry.label ?? null,
          before: json(entry.before),
          after: json(entry.after),
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed (${entry.module}/${entry.action})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
