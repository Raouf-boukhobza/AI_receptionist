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
import { DoctorHoursService } from './doctor-hours.service';
import { CreateDoctorHoursDto } from './dtos/create-doctor-hours.dto';
import { UpdateDoctorHoursDto } from './dtos/update-doctor-hours.dto';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';

@Controller({
  path: 'doctors',
  version: '1',
})
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class DoctorHoursController {
  constructor(private readonly doctorHoursService: DoctorHoursService) {}

  @Post(':doctorId/hours')
  async createDoctorHours(
    @TenantId() tenantId: string,
    @Param('doctorId') doctorId: string,
    @Body() createDoctorHoursDto: CreateDoctorHoursDto,
  ) {
    return this.doctorHoursService.createDoctorHours(
      tenantId,
      doctorId,
      createDoctorHoursDto,
    );
  }

  @Get(':doctorId/hours')
  async getDoctorHoursByDoctorId(
    @TenantId() tenantId: string,
    @Param('doctorId') doctorId: string,
  ) {
    return this.doctorHoursService.getDoctorHoursByDoctorId(tenantId, doctorId);
  }

  @Get(':doctorId/hours/:id')
  async getDoctorHourById(
    @TenantId() tenantId: string,
    @Param('doctorId') doctorId: string,
    @Param('id') id: string,
  ) {
    return this.doctorHoursService.getDoctorHourById(tenantId, doctorId, id);
  }

  @Patch(':doctorId/hours/:id')
  async updateDoctorHour(
    @TenantId() tenantId: string,
    @Param('doctorId') doctorId: string,
    @Param('id') id: string,
    @Body() updateDoctorHoursDto: UpdateDoctorHoursDto,
  ) {
    return this.doctorHoursService.updateDoctorHour(
      tenantId,
      doctorId,
      id,
      updateDoctorHoursDto,
    );
  }

  @Delete(':doctorId/hours/:id')
  async deleteDoctorHour(
    @TenantId() tenantId: string,
    @Param('doctorId') doctorId: string,
    @Param('id') id: string,
  ) {
    return this.doctorHoursService.deleteDoctorHour(tenantId, doctorId, id);
  }
}
