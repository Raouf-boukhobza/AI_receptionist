import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from './outbound-messages.queue';

@Injectable()
export class OutboundSweeperService {
  private readonly logger = new Logger(OutboundSweeperService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly tenantTransaction: TenantTransaction,
    private readonly outboundMessagesQueue: OutboundMessagesQueue,
  ) {}

  async runSweep(): Promise<number> {
    const tenants = await this.prismaService.rawClient.tenants.findMany({
      where: { phone_number_id: { not: null } },
      select: { id: true },
    });

    let totalRecovered = 0;

    for (const tenant of tenants) {
      try {
        const strandedIds = await this.tenantTransaction.run(tenant.id, async (tx) => {
          const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
          const twoMinAgo = new Date(Date.now() - 2 * 60_000);

          // 1. Reset stale in-flight sends whose worker died/stalled
          await tx.messages.updateMany({
            where: {
              status: 'sending',
              dispatched_at: { lt: fiveMinAgo },
              dispatch_attempts: { lt: 3 },
            },
            data: {
              status: 'dispatch_failed',
              last_error: 'Worker timeout: send lease expired',
            },
          });

          // 2. Mark exhausted attempts as dead (prevents perpetual dispatch_failed/sending)
          await tx.messages.updateMany({
            where: {
              status: { in: ['sending', 'dispatch_failed'] },
              dispatch_attempts: { gte: 3 },
            },
            data: {
              status: 'dead',
              last_error: 'Delivery attempts exhausted (3/3)',
            },
          });

          // 3. Collect stranded rows needing BullMQ dispatch
          const rows = await tx.messages.findMany({
            where: {
              status: { in: ['pending_dispatch', 'dispatch_failed'] },
              created_at: { lt: twoMinAgo },
              dispatch_attempts: { lt: 3 },
            },
            select: { id: true },
            take: 50,
          });

          return rows.map((r) => r.id);
        });

        for (const messageId of strandedIds) {
          await this.outboundMessagesQueue.requeue({
            tenantId: tenant.id,
            messageId,
          });
          totalRecovered++;
        }
      } catch (err: any) {
        this.logger.error(
          `Sweeper run failed for tenant ${tenant.id}: ${err?.message || err}`,
          err?.stack,
        );
      }
    }

    if (totalRecovered > 0) {
      this.logger.log(`Sweeper recovered ${totalRecovered} stranded outbound messages`);
    }

    return totalRecovered;
  }
}
