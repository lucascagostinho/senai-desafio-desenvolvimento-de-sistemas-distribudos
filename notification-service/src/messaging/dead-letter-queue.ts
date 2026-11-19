import { Logger } from '@nestjs/common';
import { connect } from 'amqplib';
import { setTimeout as sleep } from 'node:timers/promises';
import { deadLetterQueueName } from './notification-events.js';

const RETRY_DELAY_MS = 5000;
const logger = new Logger('DeadLetterQueue');

// Declara a fila de mensagens "mortas" (DLQ) antes de começar a consumir.
//
// A fila "notifications" manda para cá as mensagens que este serviço recusar
// sem reenvio (dados inválidos). Se a DLQ não existisse, o RabbitMQ
// descartaria essas mensagens sem avisar. O transporte do NestJS só declara a
// fila principal, por isso a DLQ é declarada com o amqplib direto
// (assertQueue).
//
// Se o RabbitMQ estiver fora do ar na partida, tenta de novo a cada 5 s em vez
// de derrubar o serviço (o mesmo comportamento do Pagamento).
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
