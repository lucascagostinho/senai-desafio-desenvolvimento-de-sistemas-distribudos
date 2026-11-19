import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service.js';

// Exige pelo menos um filtro: a consulta nunca devolve a tabela inteira
// (com os e-mails de todos os usuários).
const listQuerySchema = z
  .strictObject({
    userId: z.string().trim().min(1).max(64).optional(),
    transactionId: z.uuid().optional(),
  })
  .refine((query) => query.userId || query.transactionId, {
    message: 'informe userId ou transactionId',
  });

// Interface REST: consulta das notificações registradas
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Ex.: GET /notifications?transactionId=<id>  ou  ?userId=u-10
  @Get()
  findAll(
    @Query({ schema: listQuerySchema })
    query: z.infer<typeof listQuerySchema>,
  ) {
    return this.notificationsService.findAll(query);
  }
}
