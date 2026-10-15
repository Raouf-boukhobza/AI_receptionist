import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateServiceDto } from './dtos/create-service.dto';
import { UpdateServiceDto } from './dtos/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prismaService: PrismaService) {}

  async createService(tenantId: string, createServiceDto: CreateServiceDto) {
    return this.prismaService.db.services.create({
      data: {
        tenant_id: tenantId,
        name: createServiceDto.name,
        price: createServiceDto.price,
        duration_minutes: createServiceDto.duration_minutes,
      },
    });
  }

  async getServices(tenantId: string) {
    return this.prismaService.db.services.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
  }

  async getServiceById(tenantId: string, id: string) {
    const service = await this.prismaService.db.services.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async updateService(
    tenantId: string,
    id: string,
    updateServiceDto: UpdateServiceDto,
  ) {
    if (
      updateServiceDto.name === null ||
      updateServiceDto.price === null ||
      updateServiceDto.duration_minutes === null
    ) {
      throw new BadRequestException(
        'Explicit null values are not allowed. Omit the field or provide a value.',
      );
    }

    const existing = await this.getServiceById(tenantId, id);

    if (
      updateServiceDto.name === undefined &&
      updateServiceDto.price === undefined &&
      updateServiceDto.duration_minutes === undefined
    ) {
      return existing;
    }

    return this.prismaService.db.services.update({
      where: { id },
      data: {
        ...(updateServiceDto.name !== undefined && {
          name: updateServiceDto.name,
        }),
        ...(updateServiceDto.price !== undefined && {
          price: updateServiceDto.price,
        }),
        ...(updateServiceDto.duration_minutes !== undefined && {
          duration_minutes: updateServiceDto.duration_minutes,
        }),
      },
    });
  }

  async deleteService(tenantId: string, id: string) {
    await this.getServiceById(tenantId, id);

    const bookingCount = await this.prismaService.db.bookings.count({
      where: { service_id: id, tenant_id: tenantId },
    });

    if (bookingCount > 0) {
      throw new ConflictException(
        'Cannot delete service with existing bookings. Keep it for history instead.',
      );
    }

    await this.prismaService.db.services.delete({
      where: { id },
    });

    return { message: 'Service deleted successfully' };
  }
}
