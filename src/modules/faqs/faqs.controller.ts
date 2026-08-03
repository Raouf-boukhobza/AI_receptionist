import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FaqsService } from './faqs.service';
import { CreateFaqDto } from './dtos/create-faq.dto';
import { UpdateFaqDto } from './dtos/update-faq.dto';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';

@Controller({
  path: 'faqs',
  version: '1',
})
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class FaqsController {
  constructor(private readonly faqsService: FaqsService) {}

  @Post()
  async createFaq(
    @TenantId() tenantId: string,
    @Body() createFaqDto: CreateFaqDto,
  ) {
    return this.faqsService.createFaq(tenantId, createFaqDto);
  }

  @Get()
  async getFaqs(@TenantId() tenantId: string) {
    return this.faqsService.getFaqs(tenantId);
  }

  @Get(':id')
  async getFaqById(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.faqsService.getFaqById(tenantId, id);
  }

  @Patch(':id')
  async updateFaq(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateFaqDto: UpdateFaqDto,
  ) {
    return this.faqsService.updateFaq(tenantId, id, updateFaqDto);
  }

  @Delete(':id')
  async deleteFaq(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.faqsService.deleteFaq(tenantId, id);
  }
}
