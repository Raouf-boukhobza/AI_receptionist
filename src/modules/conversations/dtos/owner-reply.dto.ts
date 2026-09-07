import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class OwnerReplyDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsBoolean()
  resumeAi?: boolean = true;
}
