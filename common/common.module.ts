import { Global, Module } from '@nestjs/common';
import { TenantContextInterceptor } from './tenant-context/tenant-context.interceptor';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  controllers: [],
  providers: [TenantContextInterceptor, PrismaService],
  exports: [TenantContextInterceptor, PrismaService],
})
export class CommonModule { }
