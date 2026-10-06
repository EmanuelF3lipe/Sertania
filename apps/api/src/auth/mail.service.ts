import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { SmtpSettingsService } from './smtp-settings.service';

@Injectable()
export class MailService {
  constructor(private readonly smtpSettings: SmtpSettingsService) {}

  private async smtpClient() {
    const settings = await this.smtpSettings.current();
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: settings.starttls,
      ...(settings.user !== '' && settings.password !== ''
        ? { auth: { user: settings.user, pass: settings.password } }
        : {}),
    });
    return { settings, transporter };
  }

  async sendServerInvitation(input: {
    to: string;
    link: string;
    expiresAt: Date;
    accessType: 'ADMIN' | 'USER';
  }): Promise<void> {
    try {
      const { settings, transporter } = await this.smtpClient();
      await transporter.sendMail({
        from: {
          name: settings.fromName,
          address: settings.fromAddress,
        },
        to: input.to,
        subject:
          input.accessType === 'ADMIN'
            ? 'Convite de administrador para Sertania'
            : 'Convite para acesso aos servidores de Sertania',
        text: [
          'Voce foi convidado para acessar a plataforma institucional de Sertania.',
          input.accessType === 'ADMIN'
            ? 'Este convite inclui acesso aos dashboards gerenciais autorizados.'
            : 'Este convite inclui acesso operacional autorizado.',
          '',
          `Crie sua senha neste link: ${input.link}`,
          `Este convite expira em ${input.expiresAt.toISOString()}.`,
          '',
          'Se voce nao esperava este convite, ignore esta mensagem.',
        ].join('\n'),
        html:
          `<p>Voce foi convidado para acessar a plataforma institucional de Sertania.</p>` +
          `<p>${input.accessType === 'ADMIN' ? 'Este convite inclui acesso aos dashboards gerenciais autorizados.' : 'Este convite inclui acesso operacional autorizado.'}</p>` +
          `<p><a href="${input.link}">Criar minha senha</a></p>` +
          `<p>Este convite expira em ${input.expiresAt.toISOString()}.</p>` +
          '<p>Se voce nao esperava este convite, ignore esta mensagem.</p>',
      });
    } catch {
      throw new ServiceUnavailableException('Nao foi possivel enviar o convite por e-mail.');
    }
  }

  async sendNotification(input: { to: string; subject: string; text: string }): Promise<void> {
    try {
      const { settings, transporter } = await this.smtpClient();
      await transporter.sendMail({
        from: {
          name: settings.fromName,
          address: settings.fromAddress,
        },
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    } catch {
      throw new ServiceUnavailableException('Nao foi possivel enviar a notificacao por e-mail.');
    }
  }

  async sendTest(to: string): Promise<void> {
    try {
      const { settings, transporter } = await this.smtpClient();
      await transporter.sendMail({
        from: {
          name: settings.fromName,
          address: settings.fromAddress,
        },
        to,
        subject: 'Teste de e-mail da Prefeitura de Sertania',
        text: 'O SMTP da plataforma Sertania foi configurado com sucesso.',
      });
    } catch {
      throw new ServiceUnavailableException('Nao foi possivel enviar o e-mail de teste.');
    }
  }
}
