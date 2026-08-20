

// whatsapp-whatsAppWebhook.dto.ts
import { Type } from 'class-transformer';
import {
    IsString,
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
class StatusDto {
    @IsString()
    id: string;

    @IsString()
    status: string; // sent | delivered | read | failed

    @IsString()
    timestamp: string;

    @IsString()
    recipient_id: string;
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

// ---- metadata ----
class MetadataDto {
    @IsString()
    display_phone_number: string;

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