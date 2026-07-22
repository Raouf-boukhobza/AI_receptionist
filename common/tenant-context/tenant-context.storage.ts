

import { AsyncLocalStorage } from 'node:async_hooks';

import { Prisma } from '../../generated/prisma/client';

export interface TenantContext {
  tenantId: string;
  tx : Prisma.TransactionClient;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();


