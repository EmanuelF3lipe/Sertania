import { useEffect, useState, type FormEvent } from 'react';
import { PRESETS_ACESSIBILIDADE, useAcessibilidade } from '../acessibilidade';
import { apiGet, apiPost, ErroApi } from '../api/cliente';
import { useSessao } from '../api/sessao';
import { Aviso } from './comuns';

interface SmtpSettings {
  readonly configured: boolean;
  readonly email: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly starttls: boolean;
  readonly fromAddress: string;
}

export function Configuracoes() {
  const { preset, definirPreset } = useAcessibilidade();
  const { sessao } = useSessao();
  const podeConfigurarEmail = sessao?.isServer === true && sessao.can.manageServerAccess;
  return (
    <section aria-labelledby="titulo-configuracoes">
      <div className="pagina-cabecalho">
        <div>
          <span className="sobretitulo">Preferencias</span>
          <h2 id="titulo-configuracoes">Configuracoes</h2>
        </div>
      </div>
      <div className="cartao">
        <h3>Acessibilidade</h3>
        <p className="dica">
          Escolha uma aparencia que facilite sua leitura e navegação. A preferência fica salva
          somente neste navegador.
        </p>
        <div className="preset-grade">
          {PRESETS_ACESSIBILIDADE.map((item) => (
            <button
              key={item.id}
              className={preset === item.id ? 'preset selecionado' : 'preset'}
              aria-pressed={preset === item.id}
              onClick={() => definirPreset(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </div>
      {podeConfigurarEmail && <ConfiguracaoEmail />}
    </section>
  );
}

function ConfiguracaoEmail() {
  const [email, definirEmail] = useState('');
  const [senhaApp, definirSenhaApp] = useState('');
  const [smtp, definirSmtp] = useState<SmtpSettings | null>(null);
  const [mensagem, definirMensagem] = useState<string | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [salvando, definirSalvando] = useState(false);
  const [testando, definirTestando] = useState(false);

  useEffect(() => {
    void apiGet<SmtpSettings>('/api/v1/admin/settings/smtp')
      .then((settings) => {
        definirSmtp(settings);
        definirEmail(settings.email);
      })
      .catch((reason: unknown) => {
        definirErro(
          reason instanceof ErroApi ? reason.message : 'Nao foi possivel carregar o SMTP.',
        );
      });
  }, []);

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    definirSalvando(true);
    definirMensagem(null);
    definirErro(null);
    try {
      const settings = await apiPost<SmtpSettings>('/api/v1/admin/settings/smtp', {
        email,
        appPassword: senhaApp,
      });
      definirSmtp(settings);
      definirEmail(settings.email);
      definirSenhaApp('');
      definirMensagem('SMTP do Gmail salvo. A senha de app nao fica visivel novamente.');
    } catch (reason: unknown) {
      definirErro(reason instanceof ErroApi ? reason.message : 'Nao foi possivel salvar o SMTP.');
    } finally {
      definirSalvando(false);
    }
  }

  async function enviarTeste() {
    definirTestando(true);
    definirMensagem(null);
    definirErro(null);
    try {
      const result = await apiPost<{ sentTo: string }>('/api/v1/admin/settings/smtp/test', {});
      definirMensagem(`E-mail de teste enviado para ${result.sentTo}.`);
    } catch (reason: unknown) {
      definirErro(reason instanceof ErroApi ? reason.message : 'Nao foi possivel enviar o teste.');
    } finally {
      definirTestando(false);
    }
  }

  return (
    <div className="cartao">
      <h3>Envio de e-mails</h3>
      <p className="dica">
        Configure uma conta Gmail com senha de app. A credencial é criptografada no servidor e nunca
        é salva neste navegador.
      </p>
      {smtp !== null && (
        <p className="dica">
          Status: {smtp.configured ? `configurado (${smtp.email})` : 'nao configurado'}.
        </p>
      )}
      {mensagem !== null && <Aviso tipo="info">{mensagem}</Aviso>}
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      <form onSubmit={(event) => void salvar(event)}>
        <div className="campo">
          <label className="rotulo" htmlFor="smtp-email">
            E-mail Gmail
          </label>
          <input
            id="smtp-email"
            type="email"
            value={email}
            onChange={(event) => definirEmail(event.target.value)}
            required
          />
        </div>
        <div className="campo">
          <label className="rotulo" htmlFor="smtp-senha-app">
            Senha de app
          </label>
          <input
            id="smtp-senha-app"
            type="password"
            value={senhaApp}
            onChange={(event) => definirSenhaApp(event.target.value)}
            placeholder={
              smtp?.configured === true ? 'Informe somente para trocar' : 'Senha de app do Google'
            }
            minLength={12}
            required={smtp?.configured !== true}
          />
        </div>
        <div className="linha">
          <button type="submit" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar SMTP'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={() => void enviarTeste()}
            disabled={testando || smtp?.configured !== true}
          >
            {testando ? 'Enviando...' : 'Enviar e-mail de teste'}
          </button>
        </div>
      </form>
    </div>
  );
}
