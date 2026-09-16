import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  // rawBody:true preserves the exact bytes Meta signed (X-Hub-Signature-256).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  // Meta calls GET/POST /webhook at the domain root — keep it outside /api + versioning.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'webhook', method: RequestMethod.ALL }],
  });
  app.enableVersioning({
    type: VersioningType.URI,
  });
  await app.listen(configService.get<number>('PORT') ?? 3000);
}
bootstrap();
