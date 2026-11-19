import { z } from 'zod';

// Contrato das mensagens que o Pagamento publica para a Notificação.
//
// Este serviço tem a SUA cópia do contrato (não importa código do Pagamento).
// O que une os dois serviços é só o formato da mensagem e o nome da fila.

// Argumentos da fila "notifications". Precisam ser IGUAIS aos que o Pagamento
// usa, porque os dois declaram a fila; o RabbitMQ recusa declarar a mesma fila
// com argumentos diferentes.
export const notificationsQueueOptions = (queue: string) => ({
  durable: true, // a fila sobrevive ao reinício do RabbitMQ
  arguments: {
    // Mensagens recusadas (nack sem reenvio) vão para a fila de "mortas" (DLQ)
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': deadLetterQueueName(queue),
  },
});

export const deadLetterQueueName = (queue: string) => `${queue}.dlq`;

// Tipos de evento (o "pattern" da mensagem no transporte RMQ do NestJS)
export const TRANSACTION_RECEIVED = 'transaction.received';
export const TRANSACTION_CONFIRMED = 'transaction.confirmed';

// Validação da mensagem recebida: o que chega da fila não é aceito sem conferir.
// Os limites são os mesmos que o Pagamento valida na entrada.
export const transactionEventSchema = z
  .object({
    eventId: z.uuid(),
    type: z.enum([TRANSACTION_RECEIVED, TRANSACTION_CONFIRMED]),
    occurredAt: z.iso.datetime(),
    transaction: z.object({
      id: z.uuid(),
      userId: z.string().min(1).max(64),
      userEmail: z.email().max(254),
      orderId: z.string().min(1).max(64),
      amount: z.string().regex(/^\d+\.\d{2}$/), // ex.: "150.50"
      status: z.enum(['PENDING', 'SUCCESS']),
    }),
  })
  // "recebida" chega com a transação pendente; "confirmada", com sucesso
  .refine(
    (event) =>
      (event.type === TRANSACTION_RECEIVED &&
        event.transaction.status === 'PENDING') ||
      (event.type === TRANSACTION_CONFIRMED &&
        event.transaction.status === 'SUCCESS'),
    { message: 'tipo do evento não combina com o status da transação' },
  );

export type TransactionEvent = z.infer<typeof transactionEventSchema>;
