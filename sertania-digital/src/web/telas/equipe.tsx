import { useState } from 'react';
import { ArrowRight, Pin, PinOff, Sunrise } from 'lucide-react';
import type { DemandaResumo } from '../../shared/dominio';
import { qs } from '../api';
import { useDados, useEstado } from '../nucleo';
import { MENU, type ItemMenu } from '../componentes/casca';
import { EtqPrioridade, Sla } from '../componentes/comuns';
import { PrimeirosPassos } from './admin';

interface Resumo { abertas: number; triagem: number; minhas: number; semResponsavel: number; vencidas: number; urgentes: number; concluidas7d: number }

/** Registro das mudancas desta versao, para a equipe. */
const MUDANCAS: Array<{ tipo: 'novo' | 'melhor'; titulo: string; texto: string }> = [
  { tipo: 'novo', titulo: 'Identidade visual do Sertânia', texto: 'O verde da Prefeitura com letras de cordel e a nova marca do sol com mandacaru. Tema de noite e contraste forte continuam disponíveis.' },
  { tipo: 'novo', titulo: 'Quem pode o quê', texto: 'Uma matriz mostra todos os perfis lado a lado. A administração marca e desmarca o que cada um faz, e tudo vai para a auditoria.' },
  { tipo: 'novo', titulo: 'Pedido de nova senha', texto: 'Quem perdeu a senha pede pela tela de entrada; o pedido aparece para a administração, que gera uma provisória.' },
  { tipo: 'melhor', titulo: 'Dados da prefeitura editáveis', texto: 'Nome do sistema, órgão, contatos, horário e um aviso para o cidadão, em Configurações › Órgão.' },
];

function hoje(): string {
  const t = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Recife' }).format(new Date());
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function periodo(): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Recife' }).format(new Date()));
  return h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite';
}

export function InicioEquipe() {
  const { usuario, pode, instalacao } = useEstado();
  const verFila = pode('demanda.ver');
  const { dados: r } = useDados<Resumo>(verFila ? '/gestao/resumo' : null);
  const frente = useDados<{ itens: DemandaResumo[] }>(verFila ? `/gestao/demandas${qs({ status: 'ABERTAS', limite: 6 })}` : null);
  const chave = `fixados-${usuario?.id}`;
  const [fixados, setFixados] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(chave) ?? '[]') as string[]; } catch { return []; }
  });
  const [fixando, setFixando] = useState(false);
  if (!usuario) return null;

  const salvar = (n: string[]) => {
    setFixados(n);
    try { localStorage.setItem(chave, JSON.stringify(n)); } catch { /* ignora */ }
  };
  const caminhos = MENU.flatMap((s) => s.itens).filter((i) => i.href !== '/equipe' && (i.href === '/config' || !i.perm || pode(...i.perm)));
  const marcados = fixados.map((h) => caminhos.find((i) => i.href === h)).filter((i): i is ItemMenu => !!i);

  const medidas: Array<{ rot: string; val: number | undefined; href: string; tom?: 'critico' | 'aviso' | 'ok' }> = [
    { rot: 'abertas no seu escopo', val: r?.abertas, href: '/gestao/fila' },
    { rot: 'esperando triagem', val: r?.triagem, href: '/gestao/fila?visao=triagem', tom: r?.triagem ? 'aviso' : undefined },
    { rot: 'com você', val: r?.minhas, href: '/gestao/fila?visao=minhas' },
    { rot: 'sem responsável', val: r?.semResponsavel, href: '/gestao/fila?visao=sem_responsavel' },
    { rot: 'com prazo vencido', val: r?.vencidas, href: '/gestao/fila?visao=vencidas', tom: r?.vencidas ? 'critico' : undefined },
    { rot: 'resolvidas em 7 dias', val: r?.concluidas7d, href: '/gestao/painel', tom: 'ok' },
  ];

  return (
    <div className="meu-dia">
      <section className="dia-abertura">
        <Sunrise size={30} aria-hidden="true" className="dia-sol" />
        <div>
          <p className="dia-data">{hoje()}</p>
          <h1>Boa {periodo()}, {usuario.nome.split(' ')[0]}.</h1>
          <p className="sec">{verFila ? 'Aqui está o que pede atenção no seu escopo.' : `${instalacao?.parametros.orgao ?? ''}`}</p>
        </div>
      </section>

      {pode('admin.usuarios') && <PrimeirosPassos />}

      {verFila && (
        <nav className="termometro" aria-label="Resumo do seu escopo">
          {medidas.map((m) => (
            <a key={m.rot} href={`#${m.href}`} className={m.tom ? `tom-${m.tom}` : undefined}>
              <span className="t-val">{m.val ?? '–'}</span>
              <span className="t-rot">{m.rot}</span>
            </a>
          ))}
        </nav>
      )}

      <div className="dia-colunas">
        {verFila && (
          <section className="cartao bloco-frente">
            <div className="linha entre"><h2>Na frente da fila</h2><a href="#/gestao/fila" className="pequeno">Fila completa <ArrowRight size={14} aria-hidden="true" /></a></div>
            {!frente.dados ? <p className="mudo">Carregando…</p> : frente.dados.itens.length === 0 ? (
              <p className="mudo">Nada em aberto no seu escopo. Bom sinal.</p>
            ) : (
              <ol className="frente">
                {frente.dados.itens.map((d) => (
                  <li key={d.id}>
                    <a href={`#/gestao/demanda/${d.id}`}>
                      <span className="f-cab"><code>{d.protocolo}</code><EtqPrioridade p={d.prioridade} /></span>
                      <strong>{d.servico}</strong>
                      <span className="pequeno mudo">{d.localidade ?? 'Sem localidade'} · {d.statusTexto}</span>
                      <Sla sla={d.sla} compacto />
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <div className="coluna" style={{ gap: 16 }}>
          <section className="cartao">
            <div className="linha entre">
              <h2>Caminhos fixados</h2>
              <button className="botao sec peq" onClick={() => setFixando(!fixando)} aria-pressed={fixando}><Pin size={15} /> {fixando ? 'Pronto' : 'Fixar'}</button>
            </div>
            {fixando ? (
              <ul className="fixar-lista">
                {caminhos.map((i) => {
                  const on = fixados.includes(i.href);
                  return (
                    <li key={i.href}>
                      <button aria-pressed={on} onClick={() => salvar(on ? fixados.filter((x) => x !== i.href) : [...fixados, i.href])}>
                        <i.icone size={17} aria-hidden="true" /> {i.rotulo} {on ? <PinOff size={15} className="direita" aria-label="desafixar" /> : <Pin size={15} className="direita" aria-label="fixar" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : marcados.length === 0 ? (
              <p className="sec pequeno" style={{ marginTop: 8 }}>Use <strong>Fixar</strong> para deixar aqui as telas que você abre todo dia.</p>
            ) : (
              <div className="fixados">
                {marcados.map((i) => <a key={i.href} href={`#${i.href}`}><i.icone size={18} aria-hidden="true" /> {i.rotulo}</a>)}
              </div>
            )}
          </section>

          <section className="cartao">
            <h2>O que mudou</h2>
            <ul className="mudancas">
              {MUDANCAS.map((m) => (
                <li key={m.titulo}>
                  <span className={`m-tipo ${m.tipo}`}>{m.tipo === 'novo' ? 'Novo' : 'Melhor'}</span>
                  <div><strong>{m.titulo}</strong><p className="pequeno sec">{m.texto}</p></div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
