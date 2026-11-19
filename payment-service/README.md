# payment-service

Serviço de pagamento da CompreFácil (NestJS + Prisma + RabbitMQ). Recebe a solicitação de transação, grava com status `PENDING` no banco `payment`, avisa a Notificação, processa o pagamento por uma fila interna, muda o status para `SUCCESS` e avisa a Notificação de novo.

## Rodar
Pré-requisito: a infraestrutura no ar (`docker compose up -d --wait` na raiz do repositório).

```bash
cp .env.example .env   # preencha com as senhas do .env da raiz
npm install            # também gera o Prisma Client
npm run prisma:deploy  # cria as tabelas no banco payment
npm run start:dev
```

## Interface REST (porta 3000)
| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/` | Status do serviço |
| `POST` | `/transactions` | Cria a transação (`PENDING`) e responde **202** sem esperar a confirmação nem a notificação |
| `GET` | `/transactions/:id` | Consulta o status da transação (`PENDING` → `SUCCESS` em ~5 s) |

Exemplo de corpo do `POST`:
```json
{ "userId": "u-10", "userEmail": "cliente@teste.com", "orderId": "pedido-1001", "amount": 150.5 }
```

## Interface AMQP
| Fila | Papel do serviço | Mensagens |
|---|---|---|
| `notifications` | produtor | `transaction.received` (passo II) e `transaction.confirmed` (passo V) |
| `payment-processing` (interna) | produtor e consumidor | `payment.process`: pedido de processamento de uma transação |

Fluxo dentro do serviço:
1. `POST` grava `PENDING` (I), publica `transaction.received` (II) e o pedido `payment.process`, e responde 202.
2. O consumidor da fila interna espera o tempo simulado de processamento (`PAYMENT_PROCESSING_DELAY_MS`, padrão 5 s), muda o status para `SUCCESS` (IV) e publica `transaction.confirmed` (V). Só então confirma (ack) o pedido.

Por que uma fila interna, e não um temporizador em memória:
- **Sobrevive a quedas:** se o serviço cair durante o processamento, o pedido continua na fila (durável, sem ack) e é processado quando o serviço voltar.
- **Desacopla o processamento da API:** mais instâncias do serviço dividem os pedidos da fila entre si (testado com duas instâncias: 4 pagamentos divididos 2 a 2). Hoje cada instância roda a API e o consumidor juntos; o consumidor poderia virar um processo próprio, para escalar só o processamento, sem mudar o formato das mensagens.

**Confirmação sem condição de corrida:** o status só muda se ainda estiver `PENDING`, numa única operação no banco. Se o mesmo pedido for processado duas vezes (reentrega, reconciliação ou duas instâncias), só a primeira altera; as outras apenas reenviam o aviso, que a Notificação ignora se já tiver notificado.

**Ordem garantida:** o pedido de processamento só é publicado depois de o RabbitMQ confirmar o aviso de "recebida". Assim a Notificação nunca recebe "confirmada" antes de "recebida".

**Falhas:**
- O `POST` tenta entregar cada mensagem ao RabbitMQ por até 5 s. Se o RabbitMQ não confirmar, responde 202 mesmo assim (a transação está gravada) e a transação fica `PENDING` até a reconciliação.
- **Reconciliação:** a cada 30 s (e na partida), o serviço procura transações `PENDING` há mais de 30 s e publica de novo o aviso de "recebida" e o pedido de processamento. É seguro porque todos os passos ignoram duplicatas. Configurável por `RECONCILIATION_INTERVAL_MS` e `RECONCILIATION_AFTER_MS`.
- No processamento: banco ou RabbitMQ fora → o pedido volta para a fila depois de 5 s (na reentrega, o tempo simulado não é esperado de novo); pedido inválido ou de transação inexistente → fila de mortas `payment-processing.dlq`.
- Ao parar o serviço, ele espera até 20 s o pagamento em andamento terminar; se não terminar, o pedido volta para a fila.

## Limitações conhecidas
- **Recuperação com atraso:** se o RabbitMQ estiver fora no `POST`, a transação só avança quando a reconciliação rodar com o RabbitMQ de volta (até ~1 min). A reconciliação reenvia mensagens de transações paradas, o que pode gerar mensagens repetidas (todas são ignoradas com segurança). O padrão *outbox* completo (gravar as mensagens no banco junto com a transação) seria a solução mais precisa.
- **Confirmação simulada:** não há operadora de cartão; todo pagamento é aprovado depois do tempo simulado.
- **Um usuário só no RabbitMQ:** os dois serviços usam a mesma credencial (administrador). Quem tiver essa credencial pode publicar um pedido de processamento e confirmar uma transação pendente. Num sistema real, cada serviço teria usuário próprio com permissão só nas suas filas.
- **Sem autenticação:** o `GET /transactions/:id` devolve o e-mail do usuário a quem tiver o id da transação. O enunciado não pede autenticação; por isso o serviço só escuta em `127.0.0.1`. Num sistema real, a rota exigiria login.
