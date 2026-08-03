import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dtos/create-service.dto';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';

@Controller({
  path: 'services',
  version: '1',
})
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  async addService(
    @TenantId() tenantId: string,
    @Body() createServiceDto: CreateServiceDto,
  ) {
    return this.servicesService.createService(tenantId, createServiceDto);
  }
}
