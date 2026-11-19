import { Prisma } from '../generated/prisma/client.js';

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
