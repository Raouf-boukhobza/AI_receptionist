

// whatsapp-whatsAppWebhook.dto.ts
import { Type } from 'class-transformer';
import {
    IsString,
    IsNumber,
    IsArray,
    IsOptional,
    ValidateNested,
    IsObject,
} from 'class-validator';

// ---- messages[] ----
class TextDto {
    @IsString()
    body: string;
}

export class MessageDto {
    @IsString()
    from: string;

    @IsString()
    id: string;

    @IsString()
    timestamp: string;

    @IsString()
    type: string; // 'text' | 'button' | 'image' |

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => TextDto)
    text?: TextDto;
}

// ---- statuses[] (delivery/read receipts, not client messages) ----
export class StatusErrorDto {
    @IsNumber()
    code: number;

    @IsString()
    title: string;

    @IsOptional()
    @IsString()
    message?: string;
}

export class StatusDto {
    @IsString()
    id: string;

    @IsString()
    status: string; // sent | delivered | read | failed

    @IsString()
    timestamp: string;

    @IsOptional()
    @IsString()
    recipient_id?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StatusErrorDto)
    errors?: StatusErrorDto[];
}

// ---- contacts[] ----
class ProfileDto {
    @IsString()
    name: string;
}

class ContactDto {
    @IsObject()
    @ValidateNested()
    @Type(() => ProfileDto)
    profile: ProfileDto;

    @IsString()
    wa_id: string;
}

// ---- message_echoes[] (coexistence / mobile replies from WhatsApp Business App) ----
export class MessageEchoDto {
    @IsString()
    id: string;

    @IsString()
    to: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsString()
    timestamp: string;

    @IsString()
    type: string;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => TextDto)
    text?: TextDto;
}

// ---- metadata ----
class MetadataDto {
    @IsOptional()
    @IsString()
    display_phone_number?: string;

    @IsString()
    phone_number_id: string;
}

// ---- value ----
class ValueDto {
    @IsString()
    messaging_product: string;

    @IsObject()
    @ValidateNested()
    @Type(() => MetadataDto)
    metadata: MetadataDto;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ContactDto)
    contacts?: ContactDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MessageDto)
    messages?: MessageDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MessageEchoDto)
    message_echoes?: MessageEchoDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StatusDto)
    statuses?: StatusDto[];
}

// ---- change ----
class ChangeDto {
    @IsObject()
    @ValidateNested()
    @Type(() => ValueDto)
    value: ValueDto;

    @IsString()
    field: string;
}

// ---- entry ----
class EntryDto {
    @IsString()
    id: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ChangeDto)
    changes: ChangeDto[];
}

// ---- root ----
export class WhatsappWebhookDto {
    @IsString()
    object: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => EntryDto)
    entry: EntryDto[];
}