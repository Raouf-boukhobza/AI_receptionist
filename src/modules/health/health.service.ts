import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import Redis from 'ioredis';

export interface HealthStatus {
  status: 'ok';
  checks: {
    database: 'up';
    redis: 'up';
  };
  uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthStatus> {
    const failures: string[] = [];

    try {
      await this.prismaService.rawClient.$queryRaw`SELECT 1`;
    } catch (err: any) {
      this.logger.error(`Health check: database unreachable: ${err?.message}`);
      failures.push('database');
    }

    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected PING response: ${pong}`);
      }
    } catch (err: any) {
      this.logger.error(`Health check: redis unreachable: ${err?.message}`);
      failures.push('redis');
    }

    if (failures.length > 0) {
      throw new ServiceUnavailableException(
        `Dependency check failed: ${failures.join(', ')}`,
      );
    }

    return {
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
