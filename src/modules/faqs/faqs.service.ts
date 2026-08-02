import { Injectable, NotFoundException } from '@nestjs/common';

import { CreateFaqDto } from './dtos/create-faq.dto';
import { UpdateFaqDto } from './dtos/update-faq.dto';
import { PrismaService } from 'common/prisma/prisma.service';

@Injectable()
export class FaqsService {
  constructor(private readonly prismaService: PrismaService) {}

  async createFaq(tenantId: string, createFaqDto: CreateFaqDto) {
    return this.prismaService.db.faqs.create({
      data: {
        tenant_id: tenantId,
        question: createFaqDto.question,
        answer: createFaqDto.answer,
      },
    });
  }

  async getFaqs(tenantId: string) {
    return this.prismaService.db.faqs.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
  }

  async getFaqById(tenantId: string, id: string) {
    const faq = await this.prismaService.db.faqs.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!faq) {
      throw new NotFoundException('FAQ not found');
    }

    return faq;
  }

  async updateFaq(tenantId: string, id: string, updateFaqDto: UpdateFaqDto) {
    const faq = await this.getFaqById(tenantId, id);

    return this.prismaService.db.faqs.update({
      where: { id: faq.id },
      data: {
        ...(updateFaqDto.question && { question: updateFaqDto.question }),
        ...(updateFaqDto.answer && { answer: updateFaqDto.answer }),
      },
    });
  }

  async deleteFaq(tenantId: string, id: string) {
    const faq = await this.getFaqById(tenantId, id);

    await this.prismaService.db.faqs.delete({
      where: { id: faq.id },
    });

    return { message: 'FAQ deleted successfully' };
  }
}
