import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionsService } from './transactions.service.js';

// Quantas transações reenviar por rodada (evita uma rajada enorme de uma vez)
const BATCH_SIZE = 100;

// Reconciliação periódica das transações PENDING.
//
// Problema que resolve: se o RabbitMQ estiver fora no momento do POST, a
// transação é gravada, mas o aviso de "recebida" e o pedido de processamento
// não saem, e ela ficaria PENDING para sempre.
//
// Solução: de tempos em tempos, as transações PENDING "paradas" há mais de
// N segundos são procuradas e as mensagens delas são publicadas de novo. É seguro
// reenviar porque todos os passos ignoram duplicatas:
// - a confirmação só muda o status se ainda estiver PENDING;
// - a Notificação aceita só um aviso de cada tipo por transação.
// É uma versão simplificada do padrão "outbox".
@Injectable()
export class ReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly intervalMs: number;
  private readonly staleAfterMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly transactionsService: TransactionsService,
    config: ConfigService,
  ) {
    this.intervalMs = Number(config.get('RECONCILIATION_INTERVAL_MS', 30000));
    this.staleAfterMs = Number(config.get('RECONCILIATION_AFTER_MS', 30000));
  }

  onApplicationBootstrap() {
    // Roda logo na partida (pega o que ficou pendente com o serviço desligado)
    // e depois a cada intervalo
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), this.intervalMs);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async reconcile() {
    if (this.running) return; // não deixa duas rodadas se sobreporem
    this.running = true;
    try {
      const stale = await this.transactionsService.findStalePending(
        this.staleAfterMs,
        BATCH_SIZE,
      );
      if (stale.length === 0) return;

      this.logger.warn(
        `Reconciliação: ${stale.length} transação(ões) PENDING há mais de ${this.staleAfterMs / 1000} s; reenviando as mensagens`,
      );
      for (const transaction of stale) {
        const ok = await this.transactionsService.startProcessing(transaction);
        // RabbitMQ ainda fora: para a rodada e tenta no próximo intervalo
        if (!ok) break;
      }
    } catch (error) {
      // Ex.: banco fora do ar. Tenta de novo no próximo intervalo.
      this.logger.error(
        `Reconciliação falhou: ${(error as Error).message}. Nova tentativa em ${this.intervalMs / 1000} s`,
      );
    } finally {
      this.running = false;
    }
  }
}
