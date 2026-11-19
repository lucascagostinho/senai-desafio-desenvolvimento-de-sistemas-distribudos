import { Controller, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  PROCESS_PAYMENT,
  processPaymentSchema,
} from '../messaging/payment-processing.js';
import { isTransientDatabaseError } from '../prisma/database-errors.js';
import {
  PublishFailedError,
  TransactionsService,
} from './transactions.service.js';

// Espera antes de devolver um pedido para a fila (banco ou RabbitMQ fora)
const REQUEUE_DELAY_MS = 5000;

type Outcome = 'ack' | 'dead-letter' | 'requeue';

// Consumidor da fila INTERNA de processamento do Pagamento.
@Controller()
export class PaymentProcessingConsumer {
  private readonly logger = new Logger(PaymentProcessingConsumer.name);
  private readonly processingDelayMs: number;

  constructor(
    private readonly transactionsService: TransactionsService,
    config: ConfigService,
  ) {
    this.processingDelayMs = Number(
      config.get('PAYMENT_PROCESSING_DELAY_MS', 5000),
    );
  }

  // (o <string> só escolhe a forma simples do decorator: o nome do evento)
  @EventPattern<string>(PROCESS_PAYMENT)
  async onProcessPayment(@Payload() data: unknown, @Ctx() context: RmqContext) {
    // redelivered = o RabbitMQ já tinha entregue esta mensagem antes
    const redelivered = Boolean(context.getMessage().fields?.redelivered);
    const outcome = await this.process(data, redelivered);
    if (outcome === 'requeue') await sleep(REQUEUE_DELAY_MS);

    // Ack manual, respondido ao RabbitMQ uma única vez
    const channel = context.getChannelRef();
    const message = context.getMessage();
    try {
      if (outcome === 'ack') channel.ack(message);
      else channel.nack(message, false, outcome === 'requeue');
    } catch (error) {
      // Canal fechado: sem resposta, o pedido volta para a fila sozinho
      this.logger.error(
        `Não foi possível responder ao RabbitMQ (${outcome}): ${(error as Error).message}`,
      );
    }
  }

  private async process(data: unknown, redelivered: boolean): Promise<Outcome> {
    const parsed = processPaymentSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.error('Pedido de processamento inválido enviado para a DLQ');
      return 'dead-letter';
    }
    const { transactionId } = parsed.data;

    try {
      // Simula o tempo de processamento do pagamento (ex.: falar com a
      // operadora do cartão). O enunciado não define como confirmar; aqui a
      // confirmação é simulada e sempre aprovada. Não espera de novo numa
      // reentrega nem quando a transação já está confirmada (pedido repetido
      // pela reconciliação): nesses casos só reenvia o aviso.
      const status = await this.transactionsService.findStatus(transactionId);
      if (!redelivered && status === 'PENDING') {
        await sleep(this.processingDelayMs);
      }

      const result = await this.transactionsService.confirm(transactionId);
      if (result === 'not-found') {
        this.logger.error(
          `Transação ${transactionId} não existe: pedido enviado para a DLQ`,
        );
        return 'dead-letter';
      }
      return 'ack';
    } catch (error) {
      if (
        error instanceof PublishFailedError ||
        isTransientDatabaseError(error)
      ) {
        // Banco ou RabbitMQ fora: problema passageiro. Devolve o pedido para a
        // fila; a confirmação no banco é idempotente (só altera se PENDING).
        this.logger.warn(
          `Falha passageira ao confirmar a transação ${transactionId}: devolvendo o pedido para a fila em ${REQUEUE_DELAY_MS / 1000} s`,
        );
        return 'requeue';
      }
      this.logger.error(
        `Erro inesperado ao confirmar a transação ${transactionId}, enviado para a DLQ: ${(error as Error).message}`,
      );
      return 'dead-letter';
    }
  }
}
