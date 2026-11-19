import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  TRANSACTION_CONFIRMED,
  TRANSACTION_RECEIVED,
  transactionEventSchema,
} from '../messaging/notification-events.js';
import {
  isTransientDatabaseError,
  NotificationsService,
} from './notifications.service.js';

// Espera antes de devolver uma mensagem para a fila quando o banco está fora
const REQUEUE_DELAY_MS = 5000;

type Outcome = 'ack' | 'dead-letter' | 'requeue';

// Interface AMQP (consumidor): lê a fila "notifications".
@Controller()
export class NotificationsConsumer {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  // (o <string> só escolhe a forma simples do decorator: o nome do evento)

  // III. Solicitação de transação recebida
  @EventPattern<string>(TRANSACTION_RECEIVED)
  onTransactionReceived(@Payload() data: unknown, @Ctx() context: RmqContext) {
    return this.handle(data, context);
  }

  // VI. Transação confirmada
  @EventPattern<string>(TRANSACTION_CONFIRMED)
  onTransactionConfirmed(@Payload() data: unknown, @Ctx() context: RmqContext) {
    return this.handle(data, context);
  }

  // ACK manual: a mensagem só sai da fila DEPOIS de processada. Primeiro é
  // decidido o destino da mensagem; no fim, o RabbitMQ recebe UMA única
  // resposta.
  private async handle(data: unknown, context: RmqContext) {
    const outcome = await this.process(data);

    if (outcome === 'requeue') {
      // Espera antes de devolver: como só há uma mensagem por vez (prefetch 1),
      // o consumo fica "pausado" enquanto o banco estiver fora, sem loop rápido.
      await sleep(REQUEUE_DELAY_MS);
    }

    const channel = context.getChannelRef();
    const message = context.getMessage();
    try {
      if (outcome === 'ack') channel.ack(message);
      // nack(mensagem, várias = false, reenfileirar?)
      else channel.nack(message, false, outcome === 'requeue');
    } catch (error) {
      // Canal fechado (ex.: o RabbitMQ caiu agora): sem resposta, a mensagem
      // volta para a fila sozinha e será entregue de novo.
      this.logger.error(
        `Não foi possível responder ao RabbitMQ (${outcome}): ${(error as Error).message}`,
      );
    }
  }

  private async process(data: unknown): Promise<Outcome> {
    const parsed = transactionEventSchema.safeParse(data);
    if (!parsed.success) {
      // Formato inválido: reprocessar não adianta -> fila de mortas (DLQ)
      const issues = parsed.error.issues
        .map(
          (issue) => `${issue.path.join('.') || 'mensagem'}: ${issue.message}`,
        )
        .join('; ');
      this.logger.error(`Mensagem inválida enviada para a DLQ: ${issues}`);
      return 'dead-letter';
    }

    try {
      await this.notificationsService.notify(parsed.data);
      return 'ack';
    } catch (error) {
      if (isTransientDatabaseError(error)) {
        // Banco fora do ar: o problema é passageiro e a mensagem é válida.
        // Devolve para a fila e tenta de novo depois, sem perder a notificação.
        this.logger.warn(
          `Banco indisponível ao processar o evento ${parsed.data.eventId}: devolvendo para a fila em ${REQUEUE_DELAY_MS / 1000} s`,
        );
        return 'requeue';
      }
      // Erro inesperado com uma mensagem válida: separa na DLQ para análise,
      // em vez de tentar para sempre.
      this.logger.error(
        `Falha ao processar o evento ${parsed.data.eventId}, enviado para a DLQ: ${(error as Error).message}`,
      );
      return 'dead-letter';
    }
  }
}
