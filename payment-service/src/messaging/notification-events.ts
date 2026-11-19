// Contrato das mensagens que o Pagamento publica para a Notificação.
//
// Os dois serviços NÃO compartilham código: o serviço de notificação tem a
// própria cópia deste contrato. O que os une é só o formato da mensagem
// e o nome da fila (acoplamento fraco).

// Fila durável que a Notificação consome (uma fila, dois tipos de evento).
// Os argumentos precisam ser IGUAIS nos dois serviços, porque os dois declaram
// a fila; o RabbitMQ recusa declarar a mesma fila com argumentos diferentes.
export const notificationsQueueOptions = (queue: string) => ({
  durable: true, // a fila sobrevive ao reinício do RabbitMQ
  arguments: {
    // Mensagens que falharem no processamento vão para a fila de "mortas" (DLQ)
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': `${queue}.dlq`,
  },
});

// Tipos de evento (o "pattern" da mensagem no transporte RMQ do NestJS)
export const TRANSACTION_RECEIVED = 'transaction.received';
export const TRANSACTION_CONFIRMED = 'transaction.confirmed';

export interface TransactionEvent {
  eventId: string; // id único do evento: a Notificação usa para ignorar repetidos (idempotência)
  type: typeof TRANSACTION_RECEIVED | typeof TRANSACTION_CONFIRMED;
  occurredAt: string;
  transaction: {
    id: string;
    userId: string;
    userEmail: string;
    orderId: string;
    amount: string;
    status: 'PENDING' | 'SUCCESS';
    createdAt: string;
    updatedAt: string;
  };
}
