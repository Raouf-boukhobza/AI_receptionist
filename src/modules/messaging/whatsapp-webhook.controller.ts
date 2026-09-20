import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common/interfaces';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { MessagesService } from './messages.service';
import { WhatsappWebhookDto } from './dtos/whatsAppWebhook.dto';
import { WhatsappWebhookAuthService } from '../whatsapp/whatsapp-webhook-auth.service';

/**
 * Canonical Meta Cloud API webhook at GET/POST /webhook (root, unversioned).
 * Architecture: persist-first (sync DB write) then return 200 so Meta never
 * retries a message we already stored. AI work stays async via BullMQ.
 */
@Controller({ path: 'webhook', version: VERSION_NEUTRAL })
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly webhookAuth: WhatsappWebhookAuthService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (!challenge || !this.webhookAuth.verifySubscribe(mode, verifyToken)) {
      throw new ForbiddenException('Webhook verification failed');
    }
    // Meta expects the raw challenge string back with 200 + text/plain.
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  )
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: WhatsappWebhookDto,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<string> {
    const ok = this.webhookAuth.verifySignature(req.rawBody, signature);
    if (!ok) {
      this.logger.warn('Rejected webhook POST with invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Sync persist-first: dedupe + store + enqueue AI job, then ACK.
    await this.messagesService.saveInboundMessage(payload);
    return 'EVENT_RECEIVED';
  }
}
