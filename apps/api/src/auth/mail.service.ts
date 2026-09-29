import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST', '127.0.0.1'),
      port: Number(config.get<string>('SMTP_PORT', '1025')),
      secure: false,
    });
  }

  async sendServerInvitation(input: { to: string; link: string; expiresAt: Date }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: {
          name: this.config.get<string>('SMTP_FROM_NAME', 'Prefeitura de Sertania'),
          address: this.config.get<string>('SMTP_FROM_ADDRESS', 'nao-responda@sertania.local'),
        },
        to: input.to,
        subject: 'Convite para acesso aos servidores de Sertania',
        text: [
          'Voce foi convidado para acessar a plataforma institucional de Sertania.',
          '',
          `Crie sua senha neste link: ${input.link}`,
          `Este convite expira em ${input.expiresAt.toISOString()}.`,
          '',
          'Se voce nao esperava este convite, ignore esta mensagem.',
        ].join('\n'),
        html: `<p>Voce foi convidado para acessar a plataforma institucional de Sertania.</p>` +
          `<p><a href="${input.link}">Criar minha senha</a></p>` +
          `<p>Este convite expira em ${input.expiresAt.toISOString()}.</p>` +
          '<p>Se voce nao esperava este convite, ignore esta mensagem.</p>',
      });
    } catch {
      throw new ServiceUnavailableException('Nao foi possivel enviar o convite por e-mail.');
    }
  }
}
