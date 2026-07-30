import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { extractTenantIdFromRequest } from './tenant-id.helper';

export const TenantId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest();
    return extractTenantIdFromRequest(request) as string;
  },
);