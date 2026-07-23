import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {PrismaClient} from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantContextStorage } from '../tenant-context/tenant-context.storage';

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

  public get db() : PrismaClient {
    const context = tenantContextStorage.getStore();
    const activeClient = context?.tx ?? this.client;
    return new Proxy(activeClient, {
      get: (target, prop) => (target as any)[prop],
    }) as PrismaClient;
  }

}