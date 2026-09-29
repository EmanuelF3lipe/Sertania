import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiGet, apiPost, ErroApi } from '../api/cliente';
import { Aviso, Estado } from './comuns';

interface Options {
  readonly secretariats: readonly { id: string; name: string; units: readonly { id: string; name: string }[] }[];
  readonly roles: readonly { id: string; name: string }[];
}

interface SessionSetting { readonly absoluteTtlSeconds: number }

export function GestaoServidores() {
  const [options, setOptions] = useState<Options | null>(null);
  const [email, setEmail] = useState('');
  const [secretariatId, setSecretariatId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [role, setRole] = useState('ATTENDANT');
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sessionHours, setSessionHours] = useState(8);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<Options>('/api/v1/admin/server-invitations/options'),
      apiGet<SessionSetting>('/api/v1/admin/settings/session'),
    ])
      .then(([value, setting]) => { setOptions(value); setSecretariatId(value.secretariats[0]?.id ?? ''); setRole(value.roles[0]?.id ?? 'ATTENDANT'); setSessionHours(setting.absoluteTtlSeconds / 3600); })
      .catch((reason: unknown) => setMessage(reason instanceof ErroApi ? reason.message : 'Nao foi possivel carregar as opcoes.'));
  }, []);

  const secretariat = options?.secretariats.find((item) => item.id === secretariatId);
  const units = secretariat?.units ?? [];
  useEffect(() => { if (!units.some((item) => item.id === unitId)) setUnitId(units[0]?.id ?? ''); }, [secretariatId, unitId, units]);
  const ready = useMemo(() => email.trim() !== '' && secretariatId !== '' && unitId !== '' && role !== '', [email, role, secretariatId, unitId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSent(false);
    try {
      await apiPost('/api/v1/admin/server-invitations', { email, role, secretariatId, unitId });
      setSent(true);
      setEmail('');
    } catch (reason: unknown) {
      setMessage(reason instanceof ErroApi ? reason.message : 'Nao foi possivel enviar o convite.');
    }
  }

  async function updateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSessionMessage(null);
    try {
      const result = await apiPost<SessionSetting>('/api/v1/admin/settings/session', { absoluteTtlSeconds: Math.round(sessionHours * 3600) });
      setSessionHours(result.absoluteTtlSeconds / 3600);
      setSessionMessage('Prazo salvo. Ele passa a valer no proximo login.');
    } catch (reason: unknown) {
      setSessionMessage(reason instanceof ErroApi ? reason.message : 'Nao foi possivel salvar o prazo.');
    }
  }

  if (options === null && message === null) return <Estado titulo="Carregando opcoes de cadastro" />;
  return (
    <section aria-labelledby="titulo-gestao-servidores">
      <div className="pagina-cabecalho"><div><span className="sobretitulo">Administracao de acesso</span><h2 id="titulo-gestao-servidores">Cadastrar servidor</h2></div></div>
      <div className="cartao">
        <p>O servidor recebera um e-mail com o convite, fara a verificacao do primeiro acesso e criara a propria senha.</p>
        {message !== null && <Aviso tipo="erro">{message}</Aviso>}
        {sent && <Aviso tipo="info">Convite enviado. No ambiente local, ele pode ser consultado no Mailpit.</Aviso>}
        {options !== null && <form onSubmit={(event) => void submit(event)}>
          <div className="campo"><label className="rotulo" htmlFor="servidor-email">E-mail institucional</label><input id="servidor-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <div className="campo"><label className="rotulo" htmlFor="servidor-secretaria">Secretaria</label><select id="servidor-secretaria" value={secretariatId} onChange={(event) => setSecretariatId(event.target.value)}>{options.secretariats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="campo"><label className="rotulo" htmlFor="servidor-unidade">Unidade</label><select id="servidor-unidade" value={unitId} onChange={(event) => setUnitId(event.target.value)}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="campo"><label className="rotulo" htmlFor="servidor-papel">Perfil</label><select id="servidor-papel" value={role} onChange={(event) => setRole(event.target.value)}>{options.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <button type="submit" disabled={!ready}>Enviar convite</button>
        </form>}
      </div>
      <div className="cartao">
        <span className="sobretitulo">Politica de sessao</span>
        <h3>Exigir novo login depois de</h3>
        <p className="dica">A sessao continua protegida no servidor e o prazo vale para novos logins.</p>
        {sessionMessage !== null && <Aviso tipo="info">{sessionMessage}</Aviso>}
        <form onSubmit={(event) => void updateSession(event)}>
          <div className="campo"><label className="rotulo" htmlFor="sessao-horas">Horas</label><input id="sessao-horas" type="number" min={0.25} max={168} step={0.25} value={sessionHours} onChange={(event) => setSessionHours(Number(event.target.value))} /></div>
          <button type="submit">Salvar prazo</button>
        </form>
      </div>
    </section>
  );
}
