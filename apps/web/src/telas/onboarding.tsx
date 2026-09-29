import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { apiGet, apiPost, ErroApi } from '../api/cliente';
import { Aviso, Estado } from './comuns';

interface InvitationState {
  readonly email: string;
  readonly expiresAt: string;
  readonly verificationUrl: string;
  readonly turnstileSiteKey: string;
}

interface TurnstileOptions {
  readonly sitekey: string;
  readonly callback: (token: string) => void;
  readonly 'expired-callback'?: () => void;
  readonly 'error-callback'?: () => void;
}

interface TurnstileApi {
  render(element: HTMLElement, options: TurnstileOptions): string;
  remove?(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function erroTexto(error: unknown, fallback: string): string {
  return error instanceof ErroApi ? error.message : fallback;
}

function useInvitation(token: string): { data: InvitationState | null; error: string | null } {
  const [data, setData] = useState<InvitationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiGet<InvitationState>(`/api/v1/onboarding/servidor/${encodeURIComponent(token)}`)
      .then((value) => { if (active) setData(value); })
      .catch((reason: unknown) => { if (active) setError(erroTexto(reason, 'Convite invalido ou expirado.')); });
    return () => { active = false; };
  }, [token]);
  return { data, error };
}

export function CadastroServidor({ token }: { readonly token: string }) {
  const { data, error } = useInvitation(token);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (password !== confirmation) {
      setMessage('As senhas precisam ser iguais.');
      return;
    }
    try {
      await apiPost<{ loginUrl: string }>(`/api/v1/onboarding/servidor/${encodeURIComponent(token)}/concluir`, {
        code,
        password,
      });
      setDone(true);
    } catch (reason: unknown) {
      setMessage(erroTexto(reason, 'Nao foi possivel concluir o cadastro.'));
    }
  }

  if (error !== null) return <main className="conteudo"><Aviso tipo="erro">{error}</Aviso></main>;
  if (data === null) return <main className="conteudo"><Estado titulo="Carregando convite" /></main>;
  if (done) {
    return (
      <main className="conteudo">
        <section className="cartao">
          <span className="sobretitulo">Cadastro concluido</span>
          <h1>Senha criada</h1>
          <p>Agora entre na area institucional usando seu e-mail e a senha criada.</p>
          <a className="botao" href="/api/v1/auth/login/servidor">Entrar como servidor</a>
        </section>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <section className="cartao">
        <span className="sobretitulo">Primeiro acesso institucional</span>
        <h1>Crie sua senha</h1>
        <p>Convite enviado para <strong>{data.email}</strong>.</p>
        <p className="dica">Antes de criar a senha, escaneie o QR Code com o celular, conclua a verificacao humana e informe o codigo de uso unico.</p>
        <p className="dica">O convite expira em {new Date(data.expiresAt).toLocaleString('pt-BR')}.</p>
        <div className="onboarding-qr">
          <QrCode url={data.verificationUrl} />
          <p><a href={data.verificationUrl} target="_blank" rel="noreferrer">Abrir verificacao neste dispositivo</a></p>
        </div>
        {message !== null && <Aviso tipo="erro">{message}</Aviso>}
        <form onSubmit={(event) => void submit(event)}>
          <div className="campo"><label className="rotulo" htmlFor="codigo">Codigo de uso unico</label><input id="codigo" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" required /></div>
          <div className="campo"><label className="rotulo" htmlFor="senha-nova">Nova senha</label><input id="senha-nova" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <div className="campo"><label className="rotulo" htmlFor="senha-confirmacao">Confirme a nova senha</label><input id="senha-confirmacao" type="password" minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></div>
          <button type="submit">Salvar senha</button>
        </form>
      </section>
    </main>
  );
}

export function VerificacaoServidor({ token }: { readonly token: string }) {
  const { data, error } = useInvitation(token);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function verify() {
    if (turnstileToken === null) return;
    setMessage(null);
    try {
      const result = await apiPost<{ code: string; expiresAt: string }>(
        `/api/v1/onboarding/servidor/${encodeURIComponent(token)}/verificar`,
        { turnstileToken },
      );
      setCode(result.code);
    } catch (reason: unknown) {
      setMessage(erroTexto(reason, 'Nao foi possivel validar a verificacao.'));
    }
  }

  if (error !== null) return <main className="conteudo"><Aviso tipo="erro">{error}</Aviso></main>;
  if (data === null) return <main className="conteudo"><Estado titulo="Carregando verificacao" /></main>;
  return (
    <main className="conteudo">
      <section className="cartao">
        <span className="sobretitulo">Verificacao do primeiro acesso</span>
        <h1>Confirme que voce e uma pessoa</h1>
        <p>Depois da verificacao, um codigo de uso unico sera liberado para o convite de <strong>{data.email}</strong>.</p>
        {data.turnstileSiteKey !== '' ? <Turnstile siteKey={data.turnstileSiteKey} onToken={setTurnstileToken} /> : <button className="secundario" onClick={() => setTurnstileToken('dev-turnstile-bypass')}>Executar verificacao local</button>}
        {message !== null && <Aviso tipo="erro">{message}</Aviso>}
        {code === null ? <button onClick={() => void verify()} disabled={turnstileToken === null}>Gerar codigo unico</button> : (
          <div className="aviso aviso-info">
            <strong>Codigo: {code}</strong>
            <p>Digite este codigo na tela de criacao de senha. Ele expira em poucos minutos e so pode ser usado uma vez.</p>
            <a className="botao" href={`/#/cadastro-servidor/${encodeURIComponent(token)}`}>Voltar para criar senha</a>
          </div>
        )}
      </section>
    </main>
  );
}

function QrCode({ url }: { readonly url: string }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, { width: 240, margin: 2 }).then((value) => { if (active) setSource(value); });
    return () => { active = false; };
  }, [url]);
  return source === null ? <p role="status">Gerando QR Code...</p> : <img src={source} alt="QR Code para verificacao do primeiro acesso" width={240} height={240} />;
}

function Turnstile({ siteKey, onToken }: { readonly siteKey: string; readonly onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scriptId = 'turnstile-script';
    const render = () => {
      if (container.current !== null && window.turnstile !== undefined) {
        window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      }
    };
    const existing = document.getElementById(scriptId);
    if (existing === null) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.addEventListener('load', render);
      document.head.appendChild(script);
    } else {
      render();
    }
  }, [onToken, siteKey]);
  return <div ref={container} aria-label="Verificacao humana" />;
}
