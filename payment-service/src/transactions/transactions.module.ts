import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { notificationsQueueOptions } from '../messaging/notification-events.js';
import { paymentProcessingQueueOptions } from '../messaging/payment-processing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentProcessingConsumer } from './payment-processing.consumer.js';
import { ReconciliationService } from './reconciliation.service.js';
import { TransactionsController } from './transactions.controller.js';
import {
  NOTIFICATION_CLIENT,
  PAYMENT_PROCESSING_CLIENT,
  TransactionsService,
} from './transactions.service.js';

// Cria um cliente (produtor) RabbitMQ para uma fila durável
const rmqClient = (
  name: string,
  queueEnv: string,
  queueOptions: (queue: string) => object,
) => ({
  name,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const queue = config.getOrThrow<string>(queueEnv);
    return {
      transport: Transport.RMQ as const,
      options: {
        urls: [config.getOrThrow<string>('RABBITMQ_URL')],
        queue,
        queueOptions: queueOptions(queue),
        persistent: true,
      },
    };
  },
});

@Module({
  imports: [
    // Interface AMQP (produtor): publica na fila da Notificação e na fila
    // interna de processamento
    ClientsModule.registerAsync([
      rmqClient(
        NOTIFICATION_CLIENT,
        'NOTIFICATIONS_QUEUE',
        notificationsQueueOptions,
      ),
      rmqClient(
        PAYMENT_PROCESSING_CLIENT,
        'PAYMENT_PROCESSING_QUEUE',
        paymentProcessingQueueOptions,
      ),
    ]),
  ],
  controllers: [TransactionsController, PaymentProcessingConsumer],
  providers: [TransactionsService, ReconciliationService, PrismaService],
})
export class TransactionsModule {}
