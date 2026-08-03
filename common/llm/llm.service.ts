import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey: string;
  private readonly model = 'gemini-2.5-flash';
  private readonly ai: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (this.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  
  async complete(messages: LlmMessage[]): Promise<string> {
    if (!this.apiKey || !this.ai) {
      this.logger.error('GEMINI_API_KEY is not set in environment variables');
      throw new InternalServerErrorException(
        'Gemini API key is not configured in environment variables (GEMINI_API_KEY)',
      );
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new InternalServerErrorException('Messages array cannot be empty');
    }

    // Extract system messages for systemInstruction configuration
    const systemMessages = messages
      .filter((m) => m.role === 'system' && m.content?.trim())
      .map((m) => m.content.trim());

    const systemInstruction = systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined;

    // Filter and map conversation messages (user -> user, assistant -> model)
    const conversationMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

    if (conversationMessages.length === 0 && !systemInstruction) {
      throw new InternalServerErrorException('No valid user or assistant messages provided');
    }

    const contents = conversationMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents,
        ...(systemInstruction ? { config: { systemInstruction } } : {}),
      });

      if (!response.text) {
        this.logger.error(`Unexpected or empty text in Gemini response: ${JSON.stringify(response)}`);
        throw new InternalServerErrorException('Empty response text returned from Google GenAI SDK');
      }

      return response.text;
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Error generating text completion with @google/genai: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`LLM text completion failed: ${error.message}`);
    }
  }
}
