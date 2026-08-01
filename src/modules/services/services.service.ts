import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateServiceDto } from './dtos/create-service.dto';

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
}
