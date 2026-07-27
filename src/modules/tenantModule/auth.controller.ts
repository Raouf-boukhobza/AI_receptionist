import { Body, Controller, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { SignupDto } from './dtos/signup.dto';


@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(
    private readonly tenantService: TenantService,
  ) {}
  @Post('signup')
  async signup(@Body() signupDto: SignupDto) {
    return this.tenantService.signup(signupDto);
  }

}