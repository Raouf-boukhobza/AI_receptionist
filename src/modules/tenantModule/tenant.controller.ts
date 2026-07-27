import { Controller, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';


@Controller({
  path: 'auth/tenant',
  version: '1',
})
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
  ) {}



}