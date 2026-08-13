import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SignupDto } from './dtos/signup.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Prisma } from '../../../generated/prisma/client';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dtos/login.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';

@Injectable()
export class TenantService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get refreshSecret() {
    return this.configService.get<string>('JWT_REFRESH_SECRET') ?? 'change-me';
  }

  private async signAccessToken(
    tenant: { id: string; email: string },
    expiresIn: StringValue,
  ) {
    return this.jwtService.signAsync(
      { sub: tenant.id, email: tenant.email, type: 'access' },
      { expiresIn },
    );
  }

  private async signRefreshToken(tenant: { id: string; email: string }) {
    return this.jwtService.signAsync(
      { sub: tenant.id, email: tenant.email, type: 'refresh' },
      { secret: this.refreshSecret, expiresIn: '7d' },
    );
  }

  private async buildAuthTokens(
    tenant: { id: string; email: string },
    accessExpiresIn: StringValue,
  ) {
    const [access_token, refresh_token] = await Promise.all([
      this.signAccessToken(tenant, accessExpiresIn),
      this.signRefreshToken(tenant),
    ]);

    const refreshHash = await bcrypt.hash(refresh_token, 10);
    try {
      await this.prismaService.db.tenants.update({
        where: { id: tenant.id },
        data: { refresh_token: refreshHash },
      });
      return {
        access_token,
        refresh_token,
        access_expires_in: accessExpiresIn,
        refresh_expires_in: '7d',
      };
    } catch (error) {
      throw error;
    }
  }

  async signup(signupDto: SignupDto) {
    const existing = await this.prismaService.db.tenants.findUnique({
      where: { email: signupDto.email },
    });
    if (existing) {
      throw new ConflictException('User already exists with this email');
    }

    const passHash = await bcrypt.hash(signupDto.password, 10);

    try {
      const tenant = await this.prismaService.db.tenants.create({
        data: {
          email: signupDto.email,
          password_hash: passHash,
          name: signupDto.name,
          business_name: signupDto.business_name,
          business_phone: signupDto.business_phone,
          personal_phone: signupDto.personal_phone,
          address: signupDto.address,
        },
      });
      return this.buildAuthTokens(
        { id: tenant.id, email: tenant.email },
        '15m',
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('User already exists with this email');
      }
      throw error;
    }
  }
  async login(loginDto: LoginDto) {
    const tenant = await this.prismaService.db.tenants.findUnique({
      where: { email: loginDto.email },
    });
    if (!tenant) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(
      loginDto.password,
      tenant.password_hash,
    );
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthTokens({ id: tenant.id, email: tenant.email }, '30m');
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const payload = await this.jwtService
      .verifyAsync<{ sub: string; type?: string }>(
        refreshTokenDto.refresh_token,
        {
          secret: this.refreshSecret,
        },
      )
      .catch(() => {
        throw new UnauthorizedException('Invalid refresh token');
      });

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tenant = await this.prismaService.db.tenants.findUnique({
      where: { id: payload.sub },
    });
    if (!tenant || !tenant.refresh_token) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const refreshMatches = await bcrypt.compare(
      refreshTokenDto.refresh_token,
      tenant.refresh_token,
    );

    if (!refreshMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.buildAuthTokens(
      {
        id: tenant.id,
        email: tenant.email,
      },
      '30m',
    );
  }

  async updateKnowledgeBasePassedAt(tenantId: string) {
    return this.prismaService.db.tenants.update({
      where: { id: tenantId },
      data: { knowledge_base_passed_at: new Date() },
    });
  }
}
