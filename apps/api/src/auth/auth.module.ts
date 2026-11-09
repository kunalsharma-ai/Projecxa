import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MfaAdminController, MfaController, MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { ObserveTokens } from '../super-admin/observe';
import { PasswordController, PasswordService, TeamController } from './password.service';
import { SsoAdminController, SsoController, SsoService } from './sso.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MfaController, MfaAdminController, SsoController, SsoAdminController, PasswordController, TeamController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, MfaService, SessionService, SsoService, PasswordService, ObserveTokens],
  exports: [PasswordService, ObserveTokens],
})
export class AuthModule {}
