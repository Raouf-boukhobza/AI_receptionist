import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dtos/create-service.dto';
import { UpdateServiceDto } from './dtos/update-service.dto';
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

  @Get()
  async getServices(@TenantId() tenantId: string) {
    return this.servicesService.getServices(tenantId);
  }

  @Get(':id')
  async getServiceById(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servicesService.getServiceById(tenantId, id);
  }

  @Patch(':id')
  async updateService(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.servicesService.updateService(tenantId, id, updateServiceDto);
  }

  @Delete(':id')
  async deleteService(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.servicesService.deleteService(tenantId, id);
  }
}
