import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { AuthController } from './auth.controller';


@Module({
  imports: [],
  controllers: [TenantController , AuthController],
  providers: [TenantService],
})
export class TenantModule {}