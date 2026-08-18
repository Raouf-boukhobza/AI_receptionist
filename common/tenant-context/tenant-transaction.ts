import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tenantContextStorage } from './tenant-context.storage';

@Injectable()
export class TenantTransaction {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Runs `fn` inside a SHORT transaction with RLS bound to `tenantId`.
   * Never wrap an LLM/HTTP call in here — keep it to milliseconds.
   */
  async run<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prismaService.rawClient.$transaction(
      async (tx) => {
        // Parameterised: no injection, no unsafe interpolation.
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
        return tenantContextStorage.run({ tenantId, tx }, () => fn(tx));
      },
      { maxWait: 2_000, timeout: 5_000 },
    );
  }
}