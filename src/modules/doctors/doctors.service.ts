import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateDoctorDto } from './dtos/create-doctor.dto';
import { UpdateDoctorDto } from './dtos/update-doctor.dto';
import { Prisma } from 'generated/prisma/client';

const doctorWithServices = {
  doctor_services: {
    include: {
      services: true,
    },
  },
};

@Injectable()
export class DoctorsService {
  constructor(private readonly prismaService: PrismaService) {}

  private async validateServiceIds(tenantId: string, serviceIds: string[]) {
    const uniqueServiceIds = Array.from(new Set(serviceIds));

    if (uniqueServiceIds.length === 0) {
      return uniqueServiceIds;
    }

    const foundServices = await this.prismaService.db.services.findMany({
      where: {
        id: { in: uniqueServiceIds },
        tenant_id: tenantId,
      },
      select: { id: true },
    });

    if (foundServices.length !== uniqueServiceIds.length) {
      throw new BadRequestException(
        'One or more service IDs are invalid or do not belong to this tenant',
      );
    }

    return uniqueServiceIds;
  }

  async createDoctor(tenantId: string, createDoctorDto: CreateDoctorDto) {
    const { name, service_ids } = createDoctorDto;

    const uniqueServiceIds = await this.validateServiceIds(
      tenantId,
      service_ids ?? [],
    );
    try {
      return this.prismaService.db.doctors.create({
        data: {
          tenant_id: tenantId,
          name,
          ...(uniqueServiceIds.length > 0
            ? {
                doctor_services: {
                  create: uniqueServiceIds.map((serviceId) => ({
                    tenant_id: tenantId,
                    service_id: serviceId,
                  })),
                },
              }
            : {}),
        },
        include: doctorWithServices,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('One or more services no longer exist');
      }
      throw error;
    }
  }

  async getDoctors(tenantId: string) {
    return this.prismaService.db.doctors.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      include: doctorWithServices,
    });
  }

  async getDoctorById(tenantId: string, id: string) {
    const doctor = await this.prismaService.db.doctors.findFirst({
      where: { id, tenant_id: tenantId },
      include: doctorWithServices,
    });

    if (!doctor) {
      throw new NotFoundException('Doctor not found');
    }

    return doctor;
  }

  async updateDoctor(
    tenantId: string,
    id: string,
    updateDoctorDto: UpdateDoctorDto,
  ) {
    if (updateDoctorDto.name === null || updateDoctorDto.service_ids === null) {
      throw new BadRequestException(
        'Explicit null values are not allowed. Omit the field or provide a value.',
      );
    }

    const existing = await this.getDoctorById(tenantId, id);

    if (
      updateDoctorDto.name === undefined &&
      updateDoctorDto.service_ids === undefined
    ) {
      return existing;
    }

    let uniqueServiceIds: string[] | undefined;
    if (updateDoctorDto.service_ids !== undefined) {
      uniqueServiceIds = await this.validateServiceIds(
        tenantId,
        updateDoctorDto.service_ids,
      );
    }

    try {
      return await this.prismaService.db.doctors.update({
        where: { id },
        data: {
          ...(updateDoctorDto.name !== undefined && {
            name: updateDoctorDto.name,
          }),
          ...(uniqueServiceIds !== undefined && {
            doctor_services: {
              deleteMany: {},
              ...(uniqueServiceIds.length > 0
                ? {
                    create: uniqueServiceIds.map((serviceId) => ({
                      tenant_id: tenantId,
                      service_id: serviceId,
                    })),
                  }
                : {}),
            },
          }),
        },
        include: doctorWithServices,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('One or more services no longer exist');
      }
      throw error;
    }
  }

  async deleteDoctor(tenantId: string, id: string) {
    await this.getDoctorById(tenantId, id);

    const bookingCount = await this.prismaService.db.bookings.count({
      where: { doctor_id: id, tenant_id: tenantId },
    });

    if (bookingCount > 0) {
      throw new ConflictException(
        'Cannot delete doctor with existing bookings. Keep the record for history instead.',
      );
    }

    await this.prismaService.db.doctors.delete({
      where: { id },
    });

    return { message: 'Doctor deleted successfully' };
  }
}
