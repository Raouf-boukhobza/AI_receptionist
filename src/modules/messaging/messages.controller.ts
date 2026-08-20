import { Body, Controller, Post } from '@nestjs/common';
import { InboundMessagesQueue } from './queue/inbound-messages.queue';
import { MessagesService } from './messages.service';
import { WhatsappWebhookDto } from './dtos/whatsAppWebhook.dto';


@Controller({
  path: 'messages',
  version: '1',
})
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
  ) {}

  @Post()
  async handleMessage(
    @Body() payload: WhatsappWebhookDto,
  ) {
    return this.messagesService.saveInboundMessage(payload)
  }
}