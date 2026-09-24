import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HealthService, HealthStatus } from './health.service';


@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  check(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}
