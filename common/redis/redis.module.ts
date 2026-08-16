import { Global, Module } from '@nestjs/common';
import { redisProvider, REDIS_CLIENT } from './redis.provider';

@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider, REDIS_CLIENT],
})
export class RedisModule {}
