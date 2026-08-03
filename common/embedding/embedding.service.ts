import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly model = 'text-embedding-004';
  private readonly ai: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (this.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  
  async embed(text: string): Promise<number[]> {
    if (!this.apiKey || !this.ai) {
      this.logger.error('GEMINI_API_KEY is not set in environment variables');
      throw new InternalServerErrorException(
        'Gemini API key is not configured in environment variables (GEMINI_API_KEY)',
      );
    }

    const trimmedText = text?.trim();
    if (!trimmedText) {
      throw new InternalServerErrorException('Cannot generate embedding for empty or whitespace text');
    }

    try {
      const response = await this.ai.models.embedContent({
        model: this.model,
        contents: trimmedText,
      });

      if (!response.embedding?.values) {
        this.logger.error(`Unexpected response structure from @google/genai embedContent: ${JSON.stringify(response)}`);
        throw new InternalServerErrorException('Invalid response structure returned from Google GenAI SDK');
      }

      return response.embedding.values;
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Error generating embedding with @google/genai: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Embedding generation failed: ${error.message}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey || !this.ai) {
      this.logger.error('GEMINI_API_KEY is not set in environment variables');
      throw new InternalServerErrorException(
        'Gemini API key is not configured in environment variables (GEMINI_API_KEY)',
      );
    }

    if (!Array.isArray(texts) || texts.length === 0) {
      throw new InternalServerErrorException('Texts array cannot be empty');
    }

    const trimmed = texts.map((t) => t?.trim());
    if (trimmed.some((t) => !t)) {
      throw new InternalServerErrorException('Cannot generate embedding for empty or whitespace text');
    }

    try {
      const response = await this.ai.models.embedContent({
        model: this.model,
        contents: trimmed,
      });

      if (!response.embeddings || response.embeddings.length !== trimmed.length) {
        this.logger.error(`Unexpected response structure from @google/genai batch embedContent: ${JSON.stringify(response)}`);
        throw new InternalServerErrorException('Invalid response structure returned from Google GenAI SDK');
      }

      return response.embeddings.map((e) => {
        if (!e.values) {
          this.logger.error(`Missing values in embedding entry: ${JSON.stringify(e)}`);
          throw new InternalServerErrorException('Invalid embedding entry returned from Google GenAI SDK');
        }
        return e.values;
      });
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Error generating batch embeddings with @google/genai: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Batch embedding generation failed: ${error.message}`);
    }
  }
}
