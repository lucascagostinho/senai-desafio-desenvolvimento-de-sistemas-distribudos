import { z } from 'zod';

// Validação da entrada do POST /transactions. Nada é gravado se os dados
// vierem errados: a API responde 400 com o motivo.
export const createTransactionSchema = z.strictObject({
  userId: z.string().trim().min(1).max(64),
  userEmail: z.email().max(254),
  orderId: z.string().trim().min(1).max(64),
  amount: z
    .number()
    .positive()
    .max(1_000_000)
    // Máximo de 2 casas decimais. A comparação usa uma tolerância porque, em
    // ponto flutuante, 150.5 * 100 pode dar 15049.999999... em vez de 15050.
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: 'amount deve ter no máximo 2 casas decimais',
    }),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const transactionIdSchema = z.uuid();
