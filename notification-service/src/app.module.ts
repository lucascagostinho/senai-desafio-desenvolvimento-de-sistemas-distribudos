import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { NotificationsModule } from './notifications/notifications.module.js';

@Module({
  imports: [
    // Lê o .env deste serviço (cada serviço tem a sua configuração)
    ConfigModule.forRoot({ isGlobal: true }),
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
