import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AgentService } from './agent.service';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';

@Controller()
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('webhook-test')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async testMessage(
    @Body() body: { tenantId: string; message: string },
  ) {
    const result = await this.agentService.getResponse(
      body.message,
      body.tenantId,
    );
    return result;
  }
}