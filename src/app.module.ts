import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from '../common/common.module';
import { TenantModule } from './modules/tenantModule/tenant.module';
import { ServicesModule } from './modules/services/services.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { FaqsModule } from './modules/faqs/faqs.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from './modules/agent/agent.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { BookingModule } from './modules/booking/booking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    TenantModule,
    ServicesModule,
    DoctorsModule,
    FaqsModule,
    KnowledgeBaseModule,
    ConversationsModule,
    AgentModule,
    MessagingModule,
    BookingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
