import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider : Provider = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService): Redis => {
    const logger = new Logger('Redis');
    const host = configService.get<string>('REDIS_HOST', 'localhost');
    const port = configService.get<number>('REDIS_PORT', 6379);
    const password = configService.get<string>('REDIS_PASSWORD');

    const client = new Redis({
      host,
      port: Number(port),
      password: password && password.trim() !== '' ? password : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    client.on('connect', () => {
      logger.log(`Connected to Redis at ${host}:${port}`);
    });

    client.on('error', (err) => {
      logger.error(`Redis error: ${err.message}`, err.stack);
    });

    return client;
  },
  inject: [ConfigService],
};
