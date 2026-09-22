import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
//
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
  // /health stays at root too so deploy probes don't need API versioning.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'webhook', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
  });

  // Auto-generated from routes + DTOs via swagger plugin (no @Api* in code).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Receptionist')
    .setDescription('Multi-tenant WhatsApp booking agent')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDoc);

  await app.listen(configService.get<number>('PORT') ?? 3000);
}
bootstrap();
