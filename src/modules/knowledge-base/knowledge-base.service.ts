import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmbeddingService } from '../../../common/embedding/embedding.service';
import { doctors, faqs, Prisma, services } from 'generated/prisma/client';
import { LlmService } from '../../../common/llm/llm.service';
import { TenantService } from '../tenantModule/tenant.service';

export interface KnowledgeChunk {
  /** Category the chunk belongs to (service | faq | doctor_hours). */
  type: 'service' | 'faq' | 'doctor_hours';
  /** Source entity ID (service.id, faq.id, doctor.id). */
  sourceId: string;
  /** Human-readable text that will be embedded. */
  content: string;
}
type TenantData = Awaited<ReturnType<KnowledgeBaseService['fetchTenantData']>>;
type Service = TenantData['services'][number];
type Faq = TenantData['faqs'][number];
type Doctor = TenantData['doctors'][number];

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly tenantService: TenantService,
  ) {}

  /**
   * Syncs all tenant data to the knowledge base with embeddings.
   * This is a complete re-sync: it deletes existing entries and adds new ones.
   */
  async syncTenantKnowledgeBase(tenantId: string) {
    this.logger.log(`Syncing knowledge base for tenant: ${tenantId}`);

    // 1. Fetch raw data
    const data = await this.fetchTenantData(tenantId);

    // 2. Create chunks
    const chunks = this.chunkTenantData(data);
    if (chunks.length === 0) {
      this.logger.warn(`No data found to sync for tenant: ${tenantId}`);
      // Even if no chunks, we should probably clear the KB
      await this.prisma.db.knowledge_base.deleteMany({
        where: { tenant_id: tenantId },
      });
      return;
    }

    // 3. Generate embeddings in batch
    const textsToEmbed = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.embedBatch(textsToEmbed);

    // 4. Update Knowledge Base in a transaction
    await this.prisma.db.$transaction(async (tx) => {
      // Clear existing entries
      await tx.knowledge_base.deleteMany({
        where: { tenant_id: tenantId },
      });

      // Insert new entries with embeddings
      // Prisma doesn't support pgvector type natively in createMany, so we use raw SQL
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const vector = embeddings[i];
        const vectorStr = `[${vector.join(',')}]`;

        await tx.$executeRaw`
          INSERT INTO "knowledge_base" ("id", "tenant_id", "content", "embedding", "metadata", "created_at", "updated_at")
          VALUES (
            gen_random_uuid(),
            ${tenantId}::uuid,
            ${chunk.content},
            ${vectorStr}::vector,
            ${JSON.stringify({ type: chunk.type, sourceId: chunk.sourceId })}::jsonb,
            NOW(),
            NOW()
          )
        `;
      }
    });

    this.logger.log(
      `Successfully synced ${chunks.length} chunks for tenant: ${tenantId}`,
    );
  }

  // verify knowledge base content
  async verifyAndRecordKnowledgeBase(tenantId: string) {
    const testResult = await this.testKnowledgeBaseContent(tenantId);
    if (testResult.allPassed) {
      await this.tenantService.updateKnowledgeBasePassedAt(tenantId);
    }
    return testResult;
  }

  // ─── Private: Data Fetching ────────────────────────────────────────

  private async fetchTenantData(tenantId: string) {
    const [services, faqs, doctors] = await Promise.all([
      this.prisma.db.services.findMany({
        where: { tenant_id: tenantId },
        include: {
          doctor_services: {
            include: { doctors: true },
          },
        },
      }),
      this.prisma.db.faqs.findMany({
        where: { tenant_id: tenantId },
      }),
      this.prisma.db.doctors.findMany({
        where: { tenant_id: tenantId },
        include: {
          doctor_hours: {
            orderBy: { day: 'asc' },
          },
        },
      }),
    ]);

    return { services, faqs, doctors };
  }

  /**
   * Transform raw tenant data into self-contained text chunks.
   *
   * Chunking rules:
   *  - Services  → one chunk per service  (name + price + duration)
   *  - FAQs      → one chunk per FAQ      (question + answer)
   *  - Doctors   → one chunk per doctor   (name + all their daily hours)
   */
  private chunkTenantData(
    data: Awaited<ReturnType<typeof this.fetchTenantData>>,
  ): KnowledgeChunk[] {
    const chunks: KnowledgeChunk[] = [];

    // --- Service chunks ---
    for (const service of data.services) {
      const lines = [
        `Service: ${service.name}`,
        `Price: ${service.price} DZD`,
        `Duration: ${service.duration_minutes} minutes`,
      ];

      const doctorNames = service.doctor_services
        .map((ds) => ds.doctors.name)
        .filter(Boolean);

      if (doctorNames.length > 0) {
        lines.push(`Provided by: ${doctorNames.join(', ')}`);
      }

      chunks.push({
        type: 'service',
        sourceId: service.id,
        content: lines.join('\n'),
      });
    }

    // --- FAQ chunks ---
    for (const faq of data.faqs) {
      chunks.push({
        type: 'faq',
        sourceId: faq.id,
        content: [`Question: ${faq.question}`, `Answer: ${faq.answer}`].join(
          '\n',
        ),
      });
    }

    // --- Doctor hours chunks (one chunk per doctor, all days combined) ---
    for (const doctor of data.doctors) {
      if (doctor.doctor_hours.length === 0) {
        continue; // skip doctors with no hours set
      }

      const hoursLines = doctor.doctor_hours.map(
        (h) => `  ${h.day}: ${h.start_time} – ${h.end_time}`,
      );

      chunks.push({
        type: 'doctor_hours',
        sourceId: doctor.id,
        content: [
          `Doctor: ${doctor.name}`,
          `Available hours:`,
          ...hoursLines,
        ].join('\n'),
      });
    }

    return chunks;
  }

  private async testKnowledgeBaseContent(tenantId: string) {
    const data = await this.fetchTenantData(tenantId);

    if (data.services.length === 0 || data.faqs.length === 0 || data.doctors.length === 0) {
      throw new BadRequestException('Cannot run test: tenant must have at least one service, doctor, and FAQ');
    }

    const service : Service = data.services[0];
    const faq : Faq = data.faqs[0];
    const doctor : Doctor = data.doctors[0];

    const testQuestions = this.buildTestQuestions(service, faq, doctor);
    const testVectors = await this.embeddingService.embedBatch(testQuestions);

    const results : any[] = [];

    for (let i = 0; i < testQuestions.length; i++) {
      const question = testQuestions[i];
      const vector = testVectors[i];

      const topChunk = await this.searchTopChunk(tenantId, vector);

      if (!topChunk || topChunk.distance > 0.5) {
        results.push({ question, passed: false });
        continue;
      }
      results.push({ question, passed: true , topChunkDistance : topChunk.distance});
    }

    const allPassed = results.every((r) => r.passed);
    return { allPassed, results };
  }




  //build the questions with the service, faq, and doctor info
  private buildTestQuestions(
    service: Service,
    faq: Faq,
    doctor: Doctor,
  ): string[] {
    return [
      `What is the price of ${service.name}?`,
      `How long is the duration of ${service.name}?`,
      `What are the available hours of ${doctor.name}?`,
      `${faq.question}?`,
    ];
  }

  //query the db for top chunk
  public async searchTopChunk(tenantId: string, vector: number[]) : Promise<{content : string , distance : number}> {
    const vectorStr = '[' + vector.join(',') + ']';

    const rows = await this.prisma.db.$queryRaw<
      { content: string; distance: number }[]
    >`
    SELECT content, embedding <=> ${vectorStr}::vector AS distance
    FROM "knowledge_base"
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT 1
  `;
    return rows[0];
  }
}
