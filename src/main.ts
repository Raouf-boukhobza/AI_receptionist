import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

async function bootstrap() {
  // rawBody:true preserves the exact bytes Meta signed (X-Hub-Signature-256).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  app.use(helmet());


  const frontendUrls = configService
    .get<string>('FRONTEND_URLS', '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  app.enableCors({
    origin:
      configService.get<string>('NODE_ENV') === 'production'
        ? frontendUrls.length > 0
          ? frontendUrls
          : false
        : true,
    credentials: true,
  });


  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );


  app.enableShutdownHooks();
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
