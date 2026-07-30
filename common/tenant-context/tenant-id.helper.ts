import { UnauthorizedException } from '@nestjs/common';

interface RequestWithUser {
  user?: {
    tenant_id?: string;
    tenantId?: string;
    id?: string;
  };
}

export function extractTenantIdFromRequest(
  request: RequestWithUser,
  failIfMissing = true,
): string | undefined {
  const tenantId =
    request?.user?.tenant_id ?? request?.user?.tenantId ?? request?.user?.id;

  if (!tenantId && failIfMissing) {
    throw new UnauthorizedException('Tenant id is missing in authenticated user');
  }

  return tenantId;
}