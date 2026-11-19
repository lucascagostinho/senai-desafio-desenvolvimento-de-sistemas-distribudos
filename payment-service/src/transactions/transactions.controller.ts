import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  createTransactionSchema,
  transactionIdSchema,
  type CreateTransactionInput,
} from './transaction.schema.js';
import { TransactionsService } from './transactions.service.js';

// Interface REST do serviço de pagamento
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // 202 Accepted: o pedido foi aceito e será concluído depois (fluxo assíncrono).
  // A resposta já volta com status PENDING, sem esperar a confirmação.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body({ schema: createTransactionSchema }) body: CreateTransactionInput,
  ) {
    return this.transactionsService.create(body);
  }

  // Consulta o status atual (permite ver PENDING -> SUCCESS sem abrir o banco)
  @Get(':id')
  findOne(@Param('id', { schema: transactionIdSchema }) id: string) {
    return this.transactionsService.findById(id);
  }
}
