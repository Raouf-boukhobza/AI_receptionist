import {
  IsEmail,
  IsEmpty,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
} from 'class-validator';

export class SignupDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(8, 20 , { message: 'Password must be between 8 and 20 characters' })
  password: string;

  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  business_name: string;
  @IsNotEmpty()
  @IsPhoneNumber()
  business_phone: string;
  @IsNotEmpty()
  @IsPhoneNumber()
  personal_phone: string;


  @IsOptional()
  @IsString()
  address?: string;
}
