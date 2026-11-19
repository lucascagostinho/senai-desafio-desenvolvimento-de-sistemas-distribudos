import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module.js';
import { ensureDeadLetterQueue } from './messaging/dead-letter-queue.js';
import { notificationsQueueOptions } from './messaging/notification-events.js';

async function bootstrap() {
  // Aplicação "híbrida": HTTP (REST) + consumidor RabbitMQ (AMQP) no mesmo processo
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const rabbitUrl = config.getOrThrow<string>('RABBITMQ_URL');
  const queue = config.getOrThrow<string>('NOTIFICATIONS_QUEUE');

  await ensureDeadLetterQueue(rabbitUrl, queue);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitUrl],
      queue,
      queueOptions: notificationsQueueOptions(queue),
      noAck: false, // ack manual, só depois de processar (o padrão do Nest é automático)
      // Uma mensagem por vez: mantém a ordem em que as mensagens chegam à fila
      // (com uma instância deste serviço), ou seja, recebida -> confirmada
      prefetchCount: 1,
      // Mensagens deste contrato são pequenas; recusa (DLQ) o que for gigante
      maxMessageSize: 64 * 1024,
      // Ao parar o serviço, termina a mensagem em andamento antes de fechar
      gracefulShutdown: true,
    },
  });

  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  const port = Number(config.get('PORT', 3001));
  // Só na máquina local (como o docker-compose): a API não tem autenticação
  await app.listen(port, '127.0.0.1');
  Logger.log(
    `notification-service ouvindo em http://localhost:${port} e consumindo a fila "${queue}"`,
    'Bootstrap',
  );
}
await bootstrap();
