# notification-service

Serviço de notificação da CompreFácil (NestJS + Prisma + RabbitMQ). Consome a fila `notifications`, registra cada notificação no banco `notification` e "envia" ao usuário (simulado no log, sem servidor de e-mail).

## Rodar
Pré-requisito: a infraestrutura no ar (`docker compose up -d --wait` na raiz do repositório).

```bash
cp .env.example .env   # preencha com as senhas do .env da raiz
npm install            # também gera o Prisma Client
npm run prisma:deploy  # cria as tabelas no banco notification
npm run start:dev
```

## Interface AMQP (consumidor)
| Evento | Passo do enunciado | Notificação |
|---|---|---|
| `transaction.received` | III | "Recebemos a sua solicitação de pagamento..." |
| `transaction.confirmed` | VI | "O pagamento ... foi confirmado." |

- **Ack manual:** a mensagem só sai da fila depois de processada. Se o serviço cair no meio, o RabbitMQ entrega de novo.
- **Uma mensagem por vez** (`prefetch 1`): mantém a ordem em que as mensagens chegam à fila (com uma instância do serviço), ou seja, recebida → confirmada.
- **Idempotência:** o banco aceita uma única notificação por `eventId` e uma única por transação + tipo. Mensagem repetida, ou evento reenviado com outro id, é ignorado: o usuário não é notificado duas vezes.
- **Fila de mensagens mortas** `notifications.dlq`: recebe as mensagens com formato inválido, sem handler (tipo de evento desconhecido), grandes demais (> 64 KB) ou com erro inesperado. Elas não travam a fila nem se perdem; dá para inspecioná-las no painel do RabbitMQ (Queues → `notifications.dlq` → Get messages). Reprocessar a DLQ automaticamente fica como melhoria.
- **Banco fora do ar:** a mensagem é válida, então não vai para a DLQ: volta para a fila a cada 5 s até o banco responder. Nenhuma notificação se perde.
- **Este serviço desligado:** as mensagens **esperam na fila** e são processadas quando ele voltar.
- **RabbitMQ fora do ar na partida:** o serviço tenta conectar de novo a cada 5 s, sem cair.
- Ao parar o serviço (Ctrl+C), ele termina a mensagem em andamento antes de fechar.

## Interface REST (porta 3001)
| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/` | Status do serviço |
| `GET` | `/notifications?userId=...` ou `?transactionId=...` | Lista as notificações (filtro obrigatório, até 50 registros) |

## Limitações conhecidas
- **Sem autenticação:** quem tiver o `userId` ou o `transactionId` vê as notificações (com o e-mail). O enunciado não pede autenticação; por isso o serviço só escuta em `127.0.0.1`.
- **Envio simulado:** a notificação é registrada no banco e escrita no log; não há servidor de e-mail.
