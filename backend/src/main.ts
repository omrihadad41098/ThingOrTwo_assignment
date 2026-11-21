import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { prepareDatabase } from './db/migrate';
import { Sweeper } from './sweeper/sweeper';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  await prepareDatabase(env);
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Fan-Username'],
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  const config = new DocumentBuilder()
    .setTitle('SeatRush')
    .setDescription('Holds and orders for a seat drop. Send X-Fan-Username on fan routes.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Fan-Username', in: 'header' }, 'fan')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(env.port, '0.0.0.0');
  app.get(Sweeper).start();
}

void bootstrap();
