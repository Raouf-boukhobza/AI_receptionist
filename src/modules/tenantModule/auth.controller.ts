import { Body, Controller, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';


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

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.tenantService.login(loginDto);
  }

  @Post('refresh')
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.tenantService.refreshToken(refreshTokenDto);
  }

}