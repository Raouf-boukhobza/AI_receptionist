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
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dtos/create-doctor.dto';
import { UpdateDoctorDto } from './dtos/update-doctor.dto';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';

@Controller({
  path: 'doctors',
  version: '1',
})
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  async createDoctor(
    @TenantId() tenantId: string,
    @Body() createDoctorDto: CreateDoctorDto,
  ) {
    return this.doctorsService.createDoctor(tenantId, createDoctorDto);
  }

  @Get()
  async getDoctors(@TenantId() tenantId: string) {
    return this.doctorsService.getDoctors(tenantId);
  }

  @Get(':id')
  async getDoctorById(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.doctorsService.getDoctorById(tenantId, id);
  }

  @Patch(':id')
  async updateDoctor(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDoctorDto: UpdateDoctorDto,
  ) {
    return this.doctorsService.updateDoctor(tenantId, id, updateDoctorDto);
  }

  @Delete(':id')
  async deleteDoctor(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.doctorsService.deleteDoctor(tenantId, id);
  }
}
