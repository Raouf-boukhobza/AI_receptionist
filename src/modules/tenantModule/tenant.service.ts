import { ConflictException, Injectable } from '@nestjs/common';
import { SignupDto } from './dtos/signup.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly prismaService: PrismaService) {}

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
      return tenant;
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
}
