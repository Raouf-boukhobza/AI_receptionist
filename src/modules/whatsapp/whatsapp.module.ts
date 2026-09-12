import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsappClient } from './whatsapp.client';

@Module({
  imports: [ConfigModule],
  providers: [WhatsappClient],
  exports: [WhatsappClient],
})
export class WhatsappModule {}
