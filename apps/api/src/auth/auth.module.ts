import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MfaAdminController, MfaController, MfaService } from './mfa.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MfaController, MfaAdminController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, MfaService],
})
export class AuthModule {}
