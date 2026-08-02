import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dtos/create-doctor.dto';
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
}
