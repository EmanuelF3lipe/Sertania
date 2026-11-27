import { useEffect, useState } from 'react';
import { Mail, MessageCircle, Send, Smartphone } from 'lucide-react';
import { STATUS, STATUS_TEXTO, type Status } from '../../shared/dominio';
import { api, fmtData, post } from '../api';
import { useDados } from '../nucleo';
import { Aviso, Carregando } from '../componentes/comuns';

type Via = 'WHATSAPP' | 'SMS' | 'EMAIL';
interface Canal { tipo: string; pronto: boolean; falta: string[] }
interface Preferencias { situacoes: Status[]; pesquisaAtiva: boolean; pesquisaHoras: number; relatorioMensalAtivo: boolean; horaInicio: number; horaFim: number }
type StatusMsg = 'PENDENTE' | 'ENVIADA' | 'FALHOU' | 'CANCELADA' | 'SEM_PROVEDOR' | 'HISTORICO';
interface Estado {
  urlPublica: string;
  canais: Record<Via, Canal>;
  modelosWhatsapp: { situacao: boolean; pesquisa: boolean };
  preferencias: Preferencias;
  proximoRelatorio: string;
  mesPrevia: string;
  porStatus: Partial<Record<StatusMsg, number>>;
  porTipo: Partial<Record<string, number>>;
  ultimas: Array<{ id: number; tipo: string; canal: string; destino: string; via: string | null; status: StatusMsg; tentativas: number; erro: string | null; criadoEm: string; enviadoEm: string | null; proximaEm: string; protocolo: string | null; resumo: string }>;
}

const NOME_VIA: Record<Via, string> = { WHATSAPP: 'WhatsApp', SMS: 'SMS', EMAIL: 'E-mail' };
const ICONE_VIA = { WHATSAPP: MessageCircle, SMS: Smartphone, EMAIL: Mail } as const;
const NOME_TIPO: Record<string, string> = { webhook: 'webhook da Prefeitura', smtp: 'servidor de e-mail (SMTP)', twilio: 'Twilio', meta: 'WhatsApp oficial (Meta)', desligado: 'desligado' };
const NOME_MSG: Record<string, string> = { SITUACAO: 'Situação', PESQUISA: 'Pesquisa', RELATORIO_MENSAL: 'Relatório mensal' };
const NOME_STATUS: Record<StatusMsg, string> = { PENDENTE: 'na fila', ENVIADA: 'enviada', FALHOU: 'falhou', CANCELADA: 'cancelada', SEM_PROVEDOR: 'sem canal configurado', HISTORICO: 'só registrada' };
type Msg = { t: 'ok' | 'erro' | 'info'; m: string } | null;

export function AvisosMensagens() {
  const { dados: inicial, erro } = useDados<Estado>('/admin/avisos');
  const [d, setD] = useState<Estado | null>(null);
  const [p, setP] = useState<Preferencias | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [teste, setTeste] = useState<{ via: Via; para: string }>({ via: 'EMAIL', para: '' });
  const [msgTeste, setMsgTeste] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (inicial) { setD(inicial); setP(inicial.preferencias); } }, [inicial]);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!d || !p) return <Carregando />;

  const acao = async (fazer: () => Promise<Estado & { resumo?: { enviadas: number; falhas: number; canceladas: number; semProvedor: number }; assunto?: string }>, ok: (r: Awaited<ReturnType<typeof fazer>>) => string) => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fazer();
      setD(r);
      setMsg({ t: 'ok', m: ok(r) });
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); } finally { setOcupado(false); }
  };
  const salvar = () => acao(() => api('PUT', '/admin/avisos/preferencias', p), () => 'Preferências salvas. A mudança fica na auditoria.');
  const processar = () => acao(() => post('/admin/avisos/processar'), (r) => `Fila processada: ${r.resumo!.enviadas} enviada(s), ${r.resumo!.falhas} falha(s), ${r.resumo!.semProvedor} sem canal configurado.`);
  const previa = () => acao(() => post('/admin/avisos/relatorio-previa'), (r) => `Prévia “${r.assunto}” ${r.resumo!.enviadas ? 'enviada para o seu e-mail' : 'gravada na fila (o envio de e-mail ainda não está configurado)'}.`);
  const reenviar = (id: number) => acao(() => post(`/admin/avisos/${id}/reenviar`), () => 'Mensagem de volta à fila. Ela sai no próximo minuto.');
  const enviarTeste = async () => {
    setMsgTeste(null);
    try {
      const r = await post<{ ok: boolean; erro?: string }>('/admin/avisos/teste', teste);
      setMsgTeste(r.ok ? { t: 'ok', m: `Enviado por ${NOME_VIA[teste.via]}. Confira se chegou.` } : { t: 'erro', m: r.erro ?? 'Não foi possível enviar.' });
    } catch (e) { setMsgTeste({ t: 'erro', m: (e as Error).message }); }
  };
  const marcar = (s: Status) => setP({ ...p, situacoes: p.situacoes.includes(s) ? p.situacoes.filter((x) => x !== s) : [...p.situacoes, s] });
  const algumPronto = (Object.values(d.canais) as Canal[]).some((c) => c.pronto);
  const s = d.porStatus;

  return (
    <>
      {!algumPronto && (
        <Aviso tipo="alerta">
          Nenhum canal de envio está configurado: as mensagens ficam registradas, mas não saem. Configure pelo menos um canal no arquivo <code>.env</code> do servidor (veja o manual, capítulo Avisos) e reinicie.
        </Aviso>
      )}

      <div className="cartao">
        <h2 className="ia-tit">Canais de envio</h2>
        <p className="sec">As chaves dos provedores ficam só no arquivo <code>.env</code> do servidor, nunca nesta tela. Para o telefone, o WhatsApp é tentado primeiro e o SMS entra se ele falhar.</p>
        <ul className="canais-envio">
          {(['WHATSAPP', 'SMS', 'EMAIL'] as Via[]).map((v) => {
            const c = d.canais[v];
            const Icone = ICONE_VIA[v];
            return (
              <li key={v} className={c.pronto ? 'pronto' : c.tipo === 'desligado' ? 'desligado' : 'falta'}>
                <span className="ce-icone"><Icone size={20} aria-hidden="true" /></span>
                <span className="ce-texto">
                  <strong>{NOME_VIA[v]}</strong>
                  <small>
                    {c.pronto ? `Pronto, por ${NOME_TIPO[c.tipo] ?? c.tipo}` : c.tipo === 'desligado' ? 'Desligado' : `Falta configurar: ${c.falta.join(', ')}`}
                    {v === 'WHATSAPP' && c.tipo === 'meta' && (!d.modelosWhatsapp.situacao || !d.modelosWhatsapp.pesquisa) ? '. Sem modelo aprovado para ' + [!d.modelosWhatsapp.situacao && 'avisos de situação', !d.modelosWhatsapp.pesquisa && 'pesquisa'].filter(Boolean).join(' e ') + ': esses saem por SMS.' : ''}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="teste-envio">
          <div className="campo"><label htmlFor="t-via">Enviar mensagem de teste por</label>
            <select id="t-via" value={teste.via} onChange={(e) => setTeste({ ...teste, via: e.target.value as Via })}>
              {(['EMAIL', 'SMS', 'WHATSAPP'] as Via[]).map((v) => <option key={v} value={v}>{NOME_VIA[v]}</option>)}
            </select></div>
          <div className="campo"><label htmlFor="t-para">{teste.via === 'EMAIL' ? 'Para o e-mail' : 'Para o telefone (com DDD)'}</label>
            <input id="t-para" value={teste.para} onChange={(e) => setTeste({ ...teste, para: e.target.value })} inputMode={teste.via === 'EMAIL' ? 'email' : 'tel'} placeholder={teste.via === 'EMAIL' ? 'voce@sertania.pe.gov.br' : '(87) 9…'} /></div>
          <button type="button" className="botao sec" disabled={teste.para.trim().length < 5} onClick={() => void enviarTeste()}><Send size={16} aria-hidden="true" /> Enviar teste</button>
        </div>
        {msgTeste && <Aviso tipo={msgTeste.t}>{msgTeste.m}</Aviso>}
      </div>

      <div className="faixa-kpi">
        <div className="kpi"><span className="rot">Enviadas (30 dias)</span><span className="val">{s.ENVIADA ?? 0}</span><span className="det">{d.porTipo['PESQUISA'] ?? 0} pesquisas, {d.porTipo['RELATORIO_MENSAL'] ?? 0} relatórios</span></div>
        <div className="kpi"><span className="rot">Na fila</span><span className="val">{s.PENDENTE ?? 0}</span><span className="det">WhatsApp e SMS esperam o horário de envio</span></div>
        <div className="kpi"><span className="rot">Falharam</span><span className="val" style={s.FALHOU ? { color: 'var(--critico)' } : undefined}>{s.FALHOU ?? 0}</span><span className="det">depois de 5 tentativas</span></div>
        <div className="kpi"><span className="rot">Sem canal configurado</span><span className="val">{s.SEM_PROVEDOR ?? 0}</span><span className="det">reenvie depois de configurar</span></div>
      </div>

      <div className="config-duas">
        <div className="cartao">
          <h2 className="ia-tit">O que o cidadão recebe</h2>
          <fieldset className="lista-marcar">
            <legend className="rotulo">Avisar quando a solicitação passar para</legend>
            {STATUS.map((st) => (
              <label key={st} className="check"><input type="checkbox" checked={p.situacoes.includes(st)} onChange={() => marcar(st)} /><span>{STATUS_TEXTO[st]}</span></label>
            ))}
          </fieldset>
          <label className="check campo"><input type="checkbox" checked={p.pesquisaAtiva} onChange={(e) => setP({ ...p, pesquisaAtiva: e.target.checked })} />
            <span><strong>Pesquisa de satisfação</strong> depois da conclusão, com um link para dar a nota sem precisar do protocolo</span></label>
          {p.pesquisaAtiva && (
            <div className="campo campo-curto"><label htmlFor="a-horas">Enviar quantas horas depois da conclusão</label>
              <input id="a-horas" type="number" min={0} max={168} value={p.pesquisaHoras} onChange={(e) => setP({ ...p, pesquisaHoras: Number(e.target.value) })} /></div>
          )}
          <div className="linha campo">
            <div className="campo-curto"><label htmlFor="a-ini">WhatsApp e SMS a partir de</label>
              <select id="a-ini" value={p.horaInicio} onChange={(e) => setP({ ...p, horaInicio: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}h</option>)}</select></div>
            <div className="campo-curto"><label htmlFor="a-fim">até</label>
              <select id="a-fim" value={p.horaFim} onChange={(e) => setP({ ...p, horaFim: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{h}h</option>)}</select></div>
          </div>
          <p className="ajuda">Fora desse horário as mensagens esperam e saem no começo do dia seguinte. O e-mail sai na hora.</p>
        </div>

        <div className="cartao">
          <h2 className="ia-tit">Relatório mensal dos secretários</h2>
          <label className="check campo"><input type="checkbox" checked={p.relatorioMensalAtivo} onChange={(e) => setP({ ...p, relatorioMensalAtivo: e.target.checked })} />
            <span>Mandar por e-mail, na primeira semana de cada mês, o resumo do mês anterior</span></label>
          <p className="sec">Cada gestor de secretaria recebe os números da sua pasta; a administração, os do município. Só números agregados, sem dados pessoais. O próximo será o de <strong>{d.proximoRelatorio}</strong>.</p>
          <button type="button" className="botao sec" disabled={ocupado} onClick={() => void previa()}><Mail size={16} aria-hidden="true" /> Receber no meu e-mail o de {d.mesPrevia}</button>
        </div>
      </div>
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <div className="linha" style={{ margin: '12px 0 20px' }}>
        <button type="button" className="botao" disabled={ocupado} onClick={() => void salvar()}>Salvar preferências</button>
        <button type="button" className="botao sec" disabled={ocupado} onClick={() => void processar()}><Send size={16} aria-hidden="true" /> Enviar a fila agora</button>
      </div>

      <div className="cartao">
        <h2 className="ia-tit">Últimas mensagens</h2>
        {d.ultimas.length === 0 ? <p className="sec">Nenhuma mensagem ainda. Elas aparecem aqui quando uma solicitação é registrada ou muda de situação.</p> : (
          <div className="ia-rolagem">
            <table className="ia-tabela">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Para</th><th>Situação</th><th><span className="so-leitor">Ação</span></th></tr></thead>
              <tbody>{d.ultimas.map((m) => (
                <tr key={m.id}>
                  <td>{fmtData(m.enviadoEm ?? m.criadoEm)}</td>
                  <td>{NOME_MSG[m.tipo] ?? m.tipo}{m.protocolo ? <div className="pequeno mudo">{m.protocolo}</div> : null}</td>
                  <td>{m.destino}<div className="pequeno mudo">{m.via ? NOME_VIA[m.via as Via] ?? m.via : m.canal === 'EMAIL' ? 'e-mail' : 'telefone'}</div></td>
                  <td><span className={`selo-msg ${m.status}`}>{NOME_STATUS[m.status]}</span>
                    {m.status === 'PENDENTE' && m.tentativas > 0 && <div className="pequeno mudo">tentativa {m.tentativas + 1} às {fmtData(m.proximaEm)}</div>}
                    {m.erro && m.status !== 'HISTORICO' && <div className="pequeno mudo erro-msg">{m.erro}</div>}</td>
                  <td>{(m.status === 'FALHOU' || m.status === 'SEM_PROVEDOR' || m.status === 'CANCELADA') && <button type="button" className="botao sec peq" onClick={() => void reenviar(m.id)}>Reenviar</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
