import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { TransactionsModule } from './transactions/transactions.module.js';

@Module({
  imports: [
    // Lê o .env deste serviço (cada serviço tem a sua configuração)
    ConfigModule.forRoot({ isGlobal: true }),
    TransactionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
