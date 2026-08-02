import { Module } from '@nestjs/common';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { DoctorHoursController } from './doctor-hours.controller';
import { DoctorHoursService } from './doctor-hours.service';

@Module({
  controllers: [DoctorsController, DoctorHoursController],
  providers: [DoctorsService, DoctorHoursService],
  exports: [DoctorsService, DoctorHoursService],
})
export class DoctorsModule {}
