import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsConsumer } from './notifications.consumer.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  controllers: [NotificationsController, NotificationsConsumer],
  providers: [NotificationsService, PrismaService],
})
export class NotificationsModule {}
