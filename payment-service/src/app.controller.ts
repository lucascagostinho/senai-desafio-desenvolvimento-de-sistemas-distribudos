import { Controller, Get } from '@nestjs/common';

// Rota simples para conferir se o serviço está no ar
@Controller()
export class AppController {
  @Get()
  status() {
    return { service: 'payment-service', status: 'ok' };
  }
}
