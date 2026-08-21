import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AgentService } from './agent.service';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { InboundMessagesQueue } from '../messaging/queue/inbound-messages.queue';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';

@Controller()
export class AgentController {
  constructor() {}

  @Post('webhook-test')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @HttpCode(HttpStatus.ACCEPTED)
  async testMessage() {

  }
}