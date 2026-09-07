import { IsIn } from 'class-validator';

export class UpdateConversationStatusDto {
  @IsIn(['ai_active', 'human_active'], {
    message: 'status must be either ai_active or human_active',
  })
  status: 'ai_active' | 'human_active';
}
