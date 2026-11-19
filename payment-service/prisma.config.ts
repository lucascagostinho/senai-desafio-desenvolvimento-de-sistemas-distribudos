// Configuração da CLI do Prisma (migrações e geração do client).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
    // Banco rascunho usado pelo "prisma migrate dev" para comparar o schema.
    // Foi criado pelo script de init do docker-compose (payment_shadow).
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
