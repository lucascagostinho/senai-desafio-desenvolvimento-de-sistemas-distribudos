import { Logger } from '@nestjs/common';
import { connect } from 'amqplib';
import { setTimeout as sleep } from 'node:timers/promises';
import { deadLetterQueueName } from './payment-processing.js';

const RETRY_DELAY_MS = 5000;
const logger = new Logger('DeadLetterQueue');

// Declara a fila de mensagens "mortas" (DLQ) da fila de processamento antes de
// começar a consumir. O transporte do NestJS só declara a fila principal, por
// isso a DLQ é declarada com o amqplib direto (assertQueue). Se o RabbitMQ estiver fora na partida, tenta de novo a cada 5 s.
export async function ensureDeadLetterQueue(url: string, queue: string) {
  for (;;) {
    try {
      const connection = await connect(url);
      try {
        const channel = await connection.createChannel();
        await channel.assertQueue(deadLetterQueueName(queue), {
          durable: true,
        });
        await channel.close();
      } finally {
        await connection.close();
      }
      logger.log(
        `Fila de mensagens mortas "${deadLetterQueueName(queue)}" pronta`,
      );
      return;
    } catch (error) {
      // Só a mensagem do erro: o objeto pode conter a URL com a senha
      logger.warn(
        `RabbitMQ indisponível (${(error as Error).message}). Nova tentativa em ${RETRY_DELAY_MS / 1000} s`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}
