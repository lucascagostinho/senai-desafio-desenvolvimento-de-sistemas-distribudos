import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { lastValueFrom, timeout } from 'rxjs';
import type { Transaction } from '../generated/prisma/client.js';
import {
  TRANSACTION_CONFIRMED,
  TRANSACTION_RECEIVED,
  type TransactionEvent,
} from '../messaging/notification-events.js';
import {
  PROCESS_PAYMENT,
  type ProcessPaymentMessage,
} from '../messaging/payment-processing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTransactionInput } from './transaction.schema.js';

export const NOTIFICATION_CLIENT = 'NOTIFICATION_CLIENT';
export const PAYMENT_PROCESSING_CLIENT = 'PAYMENT_PROCESSING_CLIENT';

// Tempo máximo esperando o RabbitMQ confirmar o recebimento da mensagem
const PUBLISH_TIMEOUT_MS = 5000;

// Lançado quando o aviso de "confirmada" não pôde ser publicado: o consumidor
// devolve o pedido de processamento para a fila e tenta de novo depois.
export class PublishFailedError extends Error {}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_CLIENT)
    private readonly notificationClient: ClientProxy,
    @Inject(PAYMENT_PROCESSING_CLIENT)
    private readonly processingClient: ClientProxy,
  ) {}

  // Passos I e II do enunciado (e o pedido de processamento)
  async create(input: CreateTransactionInput) {
    // I. Grava a transação com status pendente
    const transaction = await this.prisma.transaction.create({
      data: { ...input, status: 'PENDING' },
    });
    this.logger.log(`Transação ${transaction.id} gravada como PENDING`);

    // O cliente não espera a Notificação nem a confirmação: as mensagens são
    // entregues ao RabbitMQ (até 5 s cada) e a resposta é 202.
    // Se o RabbitMQ não confirmar, a transação continua PENDING e a
    // reconciliação periódica tenta de novo depois.
    await this.startProcessing(transaction);

    return toResponse(transaction);
  }

  // Publica o aviso de "recebida" (II) e o pedido de processamento.
  // Usado pelo POST e pela reconciliação. Retorna false se algo não saiu.
  async startProcessing(transaction: Transaction): Promise<boolean> {
    // II. Aviso de "solicitação recebida" para a Notificação
    const received = await this.publishEvent(TRANSACTION_RECEIVED, transaction);
    if (!received) {
      // Sem o aviso de recebida, o processamento nem é pedido: assim a
      // Notificação nunca recebe "confirmada" antes de "recebida".
      return false;
    }

    // Pedido de processamento na fila interna. Só sai depois de o RabbitMQ
    // confirmar o "recebida", o que garante a ordem recebida -> confirmada.
    const request: ProcessPaymentMessage = { transactionId: transaction.id };
    return this.publish(
      this.processingClient,
      PROCESS_PAYMENT,
      request,
      `pedido de processamento da transação ${transaction.id}`,
    );
  }

  async findStatus(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      select: { status: true },
    });
    return transaction?.status ?? null;
  }

  // Transações PENDING paradas há mais de `olderThanMs` (candidatas à
  // reconciliação: alguma mensagem delas pode não ter saído)
  findStalePending(olderThanMs: number, limit: number) {
    return this.prisma.transaction.findMany({
      where: {
        status: 'PENDING',
        updatedAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  // Passos IV e V do enunciado. Chamado pelo consumidor da fila interna.
  async confirm(transactionId: string): Promise<'confirmed' | 'not-found'> {
    // IV. Confirma: muda para SUCCESS SÓ SE ainda estiver PENDING.
    // É uma operação atômica no banco (verifica e altera de uma vez): se duas
    // instâncias processarem o mesmo pedido ao mesmo tempo, só uma altera.
    // Isso evita a condição de corrida de "ler status -> decidir -> gravar".
    const { count } = await this.prisma.transaction.updateMany({
      where: { id: transactionId, status: 'PENDING' },
      data: { status: 'SUCCESS' },
    });

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) return 'not-found';

    if (count === 1) {
      this.logger.log(`Transação ${transactionId} confirmada: SUCCESS`);
    } else {
      // Já estava SUCCESS: este pedido chegou de novo. Acontece quando o
      // serviço caiu depois de confirmar e antes do ack, quando a publicação do
      // "confirmada" falhou e o pedido voltou para a fila, ou quando a
      // reconciliação reenviou o pedido. O aviso é publicado outra vez por
      // segurança; a Notificação ignora se já tiver notificado.
      this.logger.warn(
        `Transação ${transactionId} já estava confirmada: reenviando o aviso`,
      );
    }

    // V. Publica na fila o aviso de "transação confirmada"
    const published = await this.publishEvent(
      TRANSACTION_CONFIRMED,
      transaction,
    );
    if (!published) throw new PublishFailedError();
    return 'confirmed';
  }

  async findById(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });
    if (!transaction) {
      throw new NotFoundException('Transação não encontrada');
    }
    return toResponse(transaction);
  }

  private publishEvent(
    type: TransactionEvent['type'],
    transaction: Transaction,
  ) {
    const event: TransactionEvent = {
      eventId: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      transaction: toResponse(transaction),
    };
    return this.publish(
      this.notificationClient,
      type,
      event,
      `evento ${type} da transação ${transaction.id}`,
      event.eventId,
    );
  }

  // Publica uma mensagem persistente e espera a confirmação do RabbitMQ.
  // Retorna false se o RabbitMQ não confirmou (não derruba quem chamou).
  private async publish(
    client: ClientProxy,
    pattern: string,
    data: object,
    description: string,
    messageId: string = randomUUID(),
  ): Promise<boolean> {
    // persistent: a mensagem é gravada em disco pelo RabbitMQ e sobrevive a reinício
    const record = new RmqRecordBuilder(data)
      .setOptions({
        persistent: true,
        messageId,
        contentType: 'application/json',
      })
      .build();

    try {
      // emit = evento: não espera resposta de outro serviço, só a confirmação do broker
      await lastValueFrom(
        client.emit(pattern, record).pipe(timeout(PUBLISH_TIMEOUT_MS)),
      );
      this.logger.log(`Publicado: ${description}`);
      return true;
    } catch (error) {
      // O RabbitMQ não confirmou a mensagem: está fora do ar ou não respondeu
      // em 5 s.
      //
      // Limitações conhecidas:
      // - O timeout só para de esperar. Se a conexão cair no meio do envio, a
      //   mensagem pode ainda ser entregue quando o RabbitMQ voltar; se chegar
      //   repetida, a Notificação ignora (idempotência).
      // - No POST, se as mensagens não saírem, a transação fica PENDING até a
      //   reconciliação periódica (ReconciliationService) reenviá-las.
      //
      // Atenção: quando o broker está fora, o erro é um objeto { err, url } e a
      // url contém a senha do RabbitMQ. Por isso o objeto não é registrado
      // inteiro no log, só a mensagem de um Error.
      const reason =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'RabbitMQ indisponível';
      this.logger.error(
        `Não confirmado pelo RabbitMQ: ${description} (${reason}). Pode ser entregue depois, se a conexão voltar`,
      );
      return false;
    }
  }
}

// Formato devolvido pela API (Decimal vira string "150.00")
function toResponse(transaction: Transaction) {
  return {
    id: transaction.id,
    userId: transaction.userId,
    userEmail: transaction.userEmail,
    orderId: transaction.orderId,
    amount: transaction.amount.toFixed(2),
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
