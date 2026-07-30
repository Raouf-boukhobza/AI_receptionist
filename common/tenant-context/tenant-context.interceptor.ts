import {
  CallHandler,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom, from, Observable } from 'rxjs';
import { tenantContextStorage } from './tenant-context.storage';
import { extractTenantIdFromRequest } from './tenant-id.helper';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);
  constructor(private prisma: PrismaService) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Observable<any> {
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const request = context.switchToHttp().getRequest();
    const tenantId = extractTenantIdFromRequest(request, false);
    if (!tenantId) {
      return next.handle();
    }
    if (!UUID_REGEX.test(tenantId)) {
      throw new UnauthorizedException('Invalid tenant id format');
    }
    this.logger.log(
      `Setting tenantId=${tenantId} for request`,
    )
    const resultPromise = this.prisma.rawClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_tenant = '${tenantId}'`,
      );
      return tenantContextStorage.run({ tenantId, tx }, async () => {
        try {
          return await firstValueFrom(next.handle());
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
