import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FinanceModule } from '../finance/finance.controller';
import { AccountingController, AccountingService } from './accounting.service';
import { LedgerController, LedgerService } from './ledger/ledger.service';
import { ZohoBooksController, ZohoBooksService } from './zoho-books.service';

@Module({
  imports: [FinanceModule, JwtModule.register({})],
  controllers: [AccountingController, ZohoBooksController, LedgerController],
  providers: [AccountingService, ZohoBooksService, LedgerService],
})
export class AccountingModule {}
