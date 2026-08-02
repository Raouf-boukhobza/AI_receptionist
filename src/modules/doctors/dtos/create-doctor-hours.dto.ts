import { IsEnum, IsMilitaryTime, IsNotEmpty } from 'class-validator';
import { day_of_week } from '../../../../generated/prisma/client';

export class CreateDoctorHoursDto {
  @IsEnum(day_of_week)
  @IsNotEmpty()
  day: day_of_week;

  @IsMilitaryTime()
  @IsNotEmpty()
  start_time: string;

  @IsMilitaryTime()
  @IsNotEmpty()
  end_time: string;
}
