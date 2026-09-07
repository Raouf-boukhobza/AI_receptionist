import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetConversationsQueryDto {
  @IsOptional()
  @IsIn(['ai_active', 'needs_human', 'human_active'], {
    message: 'status must be ai_active, needs_human, or human_active',
  })
  status?: 'ai_active' | 'needs_human' | 'human_active';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
