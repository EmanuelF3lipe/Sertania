import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CsrfExempt, CurrentSession, Public } from './session.guard';
import type { SessionClaims } from './session.service';
import { ServerOnboardingService } from './server-onboarding.service';

@Controller('api/v1')
export class ServerOnboardingController {
  constructor(private readonly onboarding: ServerOnboardingService) {}

  @Get('admin/server-invitations/options')
  async options(@CurrentSession() session: SessionClaims | undefined) {
    return this.onboarding.invitationOptions(session);
  }

  @Get('admin/settings/session')
  async sessionSetting(@CurrentSession() session: SessionClaims | undefined) {
    return this.onboarding.sessionSetting(session);
  }

  @Get('analytics/dashboard')
  async dashboard(@CurrentSession() session: SessionClaims | undefined) {
    return this.onboarding.dashboard(session);
  }

  @Post('admin/settings/session')
  async updateSessionSetting(
    @Body() body: { absoluteTtlSeconds?: number },
    @CurrentSession() session: SessionClaims | undefined,
  ) {
    return this.onboarding.updateSessionSetting(session, body.absoluteTtlSeconds ?? 0);
  }

  @Post('admin/server-invitations')
  async createInvitation(
    @Body() body: { email?: string; role?: string; accessType?: string; secretariatId?: string; unitId?: string },
    @CurrentSession() session: SessionClaims | undefined,
  ) {
    return this.onboarding.createInvitation({
      email: body.email ?? '',
      role: body.role ?? '',
      accessType: body.accessType ?? 'USER',
      secretariatId: body.secretariatId ?? '',
      unitId: body.unitId ?? '',
      session,
    });
  }

  @Public()
  @CsrfExempt()
  @Get('onboarding/servidor/:token')
  async state(@Param('token') token: string) {
    return this.onboarding.invitationState(token);
  }

  @Public()
  @CsrfExempt()
  @Post('onboarding/servidor/:token/verificar')
  async verify(@Param('token') token: string, @Body() body: { turnstileToken?: string }) {
    return this.onboarding.verifyHuman(token, body.turnstileToken ?? '');
  }

  @Public()
  @CsrfExempt()
  @Post('onboarding/servidor/:token/concluir')
  async complete(
    @Param('token') token: string,
    @Body() body: { code?: string; password?: string },
  ) {
    return this.onboarding.complete(token, body.code ?? '', body.password ?? '');
  }
}
