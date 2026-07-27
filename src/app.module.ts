import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from '../common/common.module';
import { TenantModule } from './modules/tenantModule/tenant.module';

@Module({
  imports: [CommonModule , TenantModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
