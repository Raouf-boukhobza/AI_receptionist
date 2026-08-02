import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateDoctorHoursDto } from './dtos/create-doctor-hours.dto';
import { UpdateDoctorHoursDto } from './dtos/update-doctor-hours.dto';
import { Prisma } from 'generated/prisma/client';

@Injectable()
export class DoctorHoursService {
  constructor(private readonly prismaService: PrismaService) {}

  private async verifyDoctorBelongsToTenant(tenantId: string, doctorId: string) {
    const doctor = await this.prismaService.db.doctors.findFirst({
      where: { id: doctorId, tenant_id: tenantId },
    });
    if (!doctor) {
      throw new NotFoundException('Doctor not found or does not belong to this tenant');
    }
    return doctor;
  }

  async createDoctorHours(
    tenantId: string,
    doctorId: string,
    createDoctorHoursDto: CreateDoctorHoursDto,
  ) {
    await this.verifyDoctorBelongsToTenant(tenantId, doctorId);

    if (createDoctorHoursDto.end_time <= createDoctorHoursDto.start_time) {
      throw new BadRequestException('end_time must be after start_time');
    }

    try {
      return await this.prismaService.db.doctor_hours.create({
        data: {
          tenant_id: tenantId,
          doctor_id: doctorId,
          day: createDoctorHoursDto.day,
          start_time: createDoctorHoursDto.start_time,
          end_time: createDoctorHoursDto.end_time,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Working hours for this doctor on ${createDoctorHoursDto.day} already exist`,
        );
      }
      throw error;
    }
  }

  async getDoctorHoursByDoctorId(tenantId: string, doctorId: string) {
    await this.verifyDoctorBelongsToTenant(tenantId, doctorId);

    return this.prismaService.db.doctor_hours.findMany({
      where: { doctor_id: doctorId, tenant_id: tenantId },
      orderBy: { day: 'asc' },
    });
  }

  async getDoctorHourById(tenantId: string, doctorId: string, id: string) {
    await this.verifyDoctorBelongsToTenant(tenantId, doctorId);

    const doctorHour = await this.prismaService.db.doctor_hours.findFirst({
      where: { id, doctor_id: doctorId, tenant_id: tenantId },
    });

    if (!doctorHour) {
      throw new NotFoundException('Doctor hours record not found for this doctor');
    }

    return doctorHour;
  }

  async updateDoctorHour(
    tenantId: string,
    doctorId: string,
    id: string,
    updateDoctorHoursDto: UpdateDoctorHoursDto,
  ) {
    await this.verifyDoctorBelongsToTenant(tenantId, doctorId);

    const existing = await this.prismaService.db.doctor_hours.findFirst({
      where: { id, doctor_id: doctorId, tenant_id: tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Doctor hours record not found for this doctor');
    }

    const startTime = updateDoctorHoursDto.start_time ?? existing.start_time;
    const endTime = updateDoctorHoursDto.end_time ?? existing.end_time;

    if (endTime <= startTime) {
      throw new BadRequestException('end_time must be after start_time');
    }

    try {
      return await this.prismaService.db.doctor_hours.update({
        where: { id },
        data: {
          ...(updateDoctorHoursDto.day && { day: updateDoctorHoursDto.day }),
          ...(updateDoctorHoursDto.start_time && { start_time: updateDoctorHoursDto.start_time }),
          ...(updateDoctorHoursDto.end_time && { end_time: updateDoctorHoursDto.end_time }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Working hours for this doctor on ${updateDoctorHoursDto.day} already exist`,
        );
      }
      throw error;
    }
  }

  async deleteDoctorHour(tenantId: string, doctorId: string, id: string) {
    await this.verifyDoctorBelongsToTenant(tenantId, doctorId);

    const existing = await this.prismaService.db.doctor_hours.findFirst({
      where: { id, doctor_id: doctorId, tenant_id: tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Doctor hours record not found for this doctor');
    }

    await this.prismaService.db.doctor_hours.delete({
      where: { id },
    });

    return { message: 'Doctor hours deleted successfully' };
  }
}
