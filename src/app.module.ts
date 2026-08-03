import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from '../common/common.module';
import { TenantModule } from './modules/tenantModule/tenant.module';
import { ServicesModule } from './modules/services/services.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { FaqsModule } from './modules/faqs/faqs.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    TenantModule,
    ServicesModule,
    DoctorsModule,
    FaqsModule,
    KnowledgeBaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
