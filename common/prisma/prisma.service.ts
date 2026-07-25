import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {PrismaClient} from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantContextStorage } from '../tenant-context/tenant-context.storage';
import { Prisma } from '@prisma/client/extension';

@Injectable()
export class PrismaService  implements OnModuleInit,OnModuleDestroy{
  private readonly client: PrismaClient;

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    this.client = new PrismaClient({ adapter });
  }
  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  public get db(): Prisma.TransactionClient {
    const context = tenantContextStorage.getStore();
    return context?.tx ?? this.client;
  }

  public get rawClient(): PrismaClient {
    return this.client;
  }

}