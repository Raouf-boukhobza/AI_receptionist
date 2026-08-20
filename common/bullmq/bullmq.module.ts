import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const password = configService.get<string>('REDIS_PASSWORD');
        return {
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: Number(configService.get<number>('REDIS_PORT', 6379)),
            password: password && password.trim() !== '' ? password : undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
  ],
  exports: [BullModule, BullBoardModule],
})
export class BullmqModule {}