import { IsEnum, IsMilitaryTime, IsOptional } from 'class-validator';
import { day_of_week } from '../../../../generated/prisma/client';

export class UpdateDoctorHoursDto {
  @IsOptional()
  @IsEnum(day_of_week)
  day?: day_of_week;

  @IsOptional()
  @IsMilitaryTime()
  start_time?: string;

  @IsOptional()
  @IsMilitaryTime()
  end_time?: string;
}
