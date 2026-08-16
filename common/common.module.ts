import { Global, Module } from '@nestjs/common';
import { TenantContextInterceptor } from './tenant-context/tenant-context.interceptor';
import { PrismaService } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.module';
import { BullmqModule } from './bullmq/bullmq.module';

@Global()
@Module({
  imports: [RedisModule, BullmqModule],
  controllers: [],
  providers: [TenantContextInterceptor, PrismaService],
  exports: [TenantContextInterceptor, PrismaService, RedisModule, BullmqModule],
})
export class CommonModule { }

