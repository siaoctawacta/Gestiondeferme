import type { RequestContext } from '../access/decorators';
import type { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction, Species } from '../generated/prisma/enums';
import { speciesModule } from './species';

/** Writes the audit row of a herd change inside the transaction that made it. */
export function auditHerd(
  audit: AuditService,
  tx: Prisma.TransactionClient,
  ctx: RequestContext,
  species: Species,
  action: AuditAction,
  recordId: string,
  label: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  return audit.log(
    {
      ctx,
      module: speciesModule(species),
      action,
      recordId,
      label,
      before,
      after,
    },
    tx,
  );
}
