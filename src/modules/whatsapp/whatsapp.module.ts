import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsappClient } from './whatsapp.client';

import { WhatsappWebhookAuthService } from './whatsapp-webhook-auth.service';

@Module({
  imports: [ConfigModule],
  providers: [WhatsappClient, WhatsappWebhookAuthService],
  exports: [WhatsappClient, WhatsappWebhookAuthService],
})
export class WhatsappModule {}
