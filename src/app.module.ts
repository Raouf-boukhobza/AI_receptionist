import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
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
import { HealthModule } from './modules/health/health.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObserveModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const appKey = config.get<string>('OBSERVE_APP_KEY', '');
        const appSecret = config.get<string>('OBSERVE_APP_SECRET', '');
        return {
          appKey,
          appSecret,
          serviceId: 'ai-receptionist',
          // No keys (CI/tests) -> SDK stays off instead of crashing boot.
          enabled: appKey.trim() !== '' && appSecret.trim() !== '',
          http: { ignore: [/^\/health(?:\?|$)/] },
        };
      },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 100 },
    ]),
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
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
