import { z } from 'zod';

// Fila INTERNA do serviço de pagamento.
//
// O POST só grava a transação e pede o processamento por esta fila. Um
// consumidor do próprio Pagamento lê a fila, confirma a transação e publica
// o aviso de "confirmada". Vantagens:
// - se o serviço reiniciar no meio, o pedido de processamento não se perde
//   (a fila é durável), ao contrário de um setTimeout em memória;
// - o processamento fica desacoplado da API: mais instâncias dividem os
//   pedidos da fila entre si. Hoje cada instância roda API e consumidor
//   juntos; o consumidor poderia virar um processo próprio, para escalar só
//   o processamento (a parte que mais consome recursos), sem mudar o formato das mensagens.

export const PROCESS_PAYMENT = 'payment.process';

export const deadLetterQueueName = (queue: string) => `${queue}.dlq`;

export const paymentProcessingQueueOptions = (queue: string) => ({
  durable: true,
  arguments: {
    // Pedidos que não podem ser processados (inválidos ou de transação
    // inexistente) vão para a fila de mortas, em vez de se perderem
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': deadLetterQueueName(queue),
  },
});

export const processPaymentSchema = z.object({
  transactionId: z.uuid(),
});

export type ProcessPaymentMessage = z.infer<typeof processPaymentSchema>;
