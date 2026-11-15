import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import type { Prisma } from '../generated/prisma/client';

const CUSTOMER_INVALID = 'Client invalide';
const CUSTOMER_INACTIVE = 'Ce client est inactif';

/** The customer of a sale document: of the caller's organisation (400, a body id) and active. */
export async function assertSaleCustomer(
  tx: Prisma.TransactionClient,
  ctx: RequestContext,
  customerId: string,
): Promise<void> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, organizationId: ctx.user.organizationId },
  });
  if (!customer) throw new BadRequestException(CUSTOMER_INVALID);
  if (!customer.active) throw new BadRequestException(CUSTOMER_INACTIVE);
}
