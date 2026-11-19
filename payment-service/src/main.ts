import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module.js';
import { ensureDeadLetterQueue } from './messaging/dead-letter-queue.js';
import { paymentProcessingQueueOptions } from './messaging/payment-processing.js';

async function bootstrap() {
  // Aplicação "híbrida": HTTP (REST) + consumidor RabbitMQ (fila interna de
  // processamento) no mesmo processo
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const rabbitUrl = config.getOrThrow<string>('RABBITMQ_URL');
  const processingQueue = config.getOrThrow<string>('PAYMENT_PROCESSING_QUEUE');

  await ensureDeadLetterQueue(rabbitUrl, processingQueue);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitUrl],
      queue: processingQueue,
      queueOptions: paymentProcessingQueueOptions(processingQueue),
      noAck: false, // ack manual, só depois de confirmar e publicar o aviso
      // Um pagamento por vez por canal (numa reconexão do canal, um pagamento
      // antigo ainda pode estar terminando: é seguro, a confirmação é condicional)
      prefetchCount: 1,
      maxMessageSize: 64 * 1024,
      // Ao parar, espera até 20 s o pagamento em andamento terminar; se não
      // terminar, o pedido volta para a fila e é reprocessado sem efeito duplicado
      gracefulShutdown: true,
      gracePeriod: 20000,
    },
  });

  // Valida corpo e parâmetros com os schemas (zod) declarados nas rotas
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // Fecha conexões (banco e RabbitMQ) ao parar o serviço com Ctrl+C
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  const port = Number(config.get('PORT', 3000));
  // Só na máquina local (como o docker-compose): a API não tem autenticação
  await app.listen(port, '127.0.0.1');
  Logger.log(
    `payment-service ouvindo em http://localhost:${port} e consumindo a fila "${processingQueue}"`,
    'Bootstrap',
  );
}
await bootstrap();
