import { Global, Module } from '@nestjs/common';
import { TenantContextInterceptor } from './tenant-context/tenant-context.interceptor';
import { PrismaService } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  controllers: [],
  providers: [TenantContextInterceptor, PrismaService],
  exports: [TenantContextInterceptor, PrismaService, RedisModule],
})
export class CommonModule { }
