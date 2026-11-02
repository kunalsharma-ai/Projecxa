import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.controller';
import { AccountingController, AccountingService } from './accounting.service';
import { ZohoBooksController, ZohoBooksService } from './zoho-books.service';

@Module({ imports: [FinanceModule], controllers: [AccountingController, ZohoBooksController], providers: [AccountingService, ZohoBooksService] })
export class AccountingModule {}
