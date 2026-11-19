import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  TRANSACTION_RECEIVED,
  type TransactionEvent,
} from '../messaging/notification-events.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Máximo de registros devolvidos pela consulta REST
const MAX_RESULTS = 50;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Passos III e VI do enunciado: notificar o usuário.
  async notify(event: TransactionEvent): Promise<void> {
    const { transaction } = event;
    const received = event.type === TRANSACTION_RECEIVED;
    const message = received
      ? `Recebemos a sua solicitação de pagamento de R$ ${transaction.amount} (pedido ${transaction.orderId}). Ela está em processamento.`
      : `O pagamento de R$ ${transaction.amount} do pedido ${transaction.orderId} foi confirmado.`;

    try {
      // Registra a notificação. O banco recusa duplicatas de dois jeitos:
      // - mesmo eventId (o RabbitMQ entregou a mesma mensagem de novo);
      // - mesma transação + tipo (o Pagamento reenviou o evento com outro id).
      await this.prisma.notification.create({
        data: {
          eventId: event.eventId,
          type: received ? 'TRANSACTION_RECEIVED' : 'TRANSACTION_CONFIRMED',
          transactionId: transaction.id,
          userId: transaction.userId,
          recipient: transaction.userEmail,
          message,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn(
          `Evento ${event.eventId} (${event.type}, transação ${transaction.id}) já notificado: ignorando (idempotência)`,
        );
        return;
      }
      throw error;
    }

    // "Envio" da notificação (simulado no log, sem servidor de e-mail).
    // Trade-off: o registro é feito ANTES do envio. Com envio real, se o serviço
    // caísse entre o registro e o envio, o reenvio da mensagem seria tratado
    // como duplicata e o e-mail não sairia ("no máximo uma vez"). Isso foi preferido
    // isso a correr o risco de notificar o usuário duas vezes.
    this.logger.log(
      `[e-mail simulado] Notificação para o usuário ${transaction.userId} (transação ${transaction.id}): ${message}`,
    );
  }

  findAll(filter: { userId?: string; transactionId?: string }) {
    return this.prisma.notification.findMany({
      where: filter,
      orderBy: { createdAt: 'asc' },
      take: MAX_RESULTS,
    });
  }
}

// P2002 = violação de chave única no Prisma
function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// Erros de conexão com o banco: passageiros (o banco pode voltar).
// P1001 servidor inacessível; P1002 timeout; P1008 operação expirou;
// P1017 conexão fechada; P2024 sem conexão livre no pool.
const TRANSIENT_PRISMA_CODES = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'];

export function isTransientDatabaseError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    TRANSIENT_PRISMA_CODES.includes(error.code)
  ) {
    return true;
  }
  // Erros de rede que o driver (pg) pode repassar
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection terminated/i.test(
    (error as Error)?.message ?? '',
  );
}
