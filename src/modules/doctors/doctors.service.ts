import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateDoctorDto } from './dtos/create-doctor.dto';
import { Prisma } from 'generated/prisma/client';

@Injectable()
export class DoctorsService {
  constructor(private readonly prismaService: PrismaService) { }

  async createDoctor(tenantId: string, createDoctorDto: CreateDoctorDto) {
    const { name, service_ids } = createDoctorDto;

    let uniqueServiceIds: string[] = [];

    if (service_ids && service_ids.length > 0) {
      uniqueServiceIds = Array.from(new Set(service_ids));

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
    }
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
        include: {
          doctor_services: {
            include: {
              services: true,
            },
          },
        },
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
}
