import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom, from, Observable } from 'rxjs';
import { tenantContextStorage } from './tenant-context.storage';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);
  constructor(private prisma: PrismaService) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Observable<any> {
    const tenantId = '22fefdfa-295f-4206-bd08-113abb260533';
    const resultPromise = this.prisma.rawClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_tenant = '${tenantId}'`,
      );
      return tenantContextStorage.run({ tenantId, tx }, async () => {
        try {
          return firstValueFrom(next.handle());
        } catch (err) {
          this.logger.error(
            `Request failed for tenantId=${tenantId}`,
            err instanceof Error ? err.stack : err,
          );
          throw err;
        }
      });
    });
    return from(resultPromise);
  }
}
