import { useEffect, useState } from 'react';
import type { Servico } from '../../shared/dominio';
import { fmtNum } from '../api';
import { ir, useDados, useEstado, useOnline } from '../nucleo';
import { Aviso } from '../componentes/comuns';
import { enviadas, pendentes, type Enviada } from '../offline';

/** Icone por palavras do nome do servico: o catalogo e da prefeitura, entao nada e fixo por id. */
const ICONES: Array<[RegExp, string]> = [
  [/l[âa]mpada|poste|ilumina/i, '💡'],
  [/buraco|cal[çc]amento|rua/i, '🚧'],
  [/bueiro|alaga|drenag|esgoto/i, '🌧️'],
  [/lixo|coleta|entulho/i, '🗑️'],
  [/[áa]rvore|poda/i, '🌳'],
  [/dengue|mosquito/i, '🦟'],
  [/escorpi|pe[çc]onhento/i, '🦂'],
  [/sa[úu]de|ubs|posto/i, '🏥'],
  [/escola|escolar/i, '🏫'],
  [/social|cras|visita/i, '🤝'],
  [/[áa]gua|pipa|cisterna|po[çc]o/i, '💧'],
  [/estrada|rural/i, '🛣️'],
];
const icone = (nome: string) => ICONES.find(([r]) => r.test(nome))?.[1] ?? '📝';

interface Transp { total: number; concluidas: number; noPrazoPct: number | null; satisfacao: number | null }

export function Inicio() {
  const { usuario, pode, catalogo, instalacao } = useEstado();
  const online = useOnline();
  const transp = useDados<Transp>('/publico/transparencia');
  const [locais, setLocais] = useState<{ pend: number; env: Enviada[] }>({ pend: 0, env: [] });
  const [protocolo, setProtocolo] = useState('');
  const [codigo, setCodigo] = useState('');
  useEffect(() => {
    Promise.all([pendentes(), enviadas()]).then(([p, e]) => setLocais({ pend: p.length, env: e.slice(-3).reverse() })).catch(() => undefined);
  }, []);

  const acompanhar = () => {
    try { sessionStorage.setItem('codigo-acesso', codigo.trim().toUpperCase()); } catch { /* sem armazenamento */ }
    ir(`/acompanhar?protocolo=${encodeURIComponent(protocolo.trim().toUpperCase())}`);
  };

  // Atalhos: os servicos do catalogo, com "Outro assunto" sempre por ultimo.
  const todos = catalogo?.servicos ?? [];
  const servicos: Servico[] = [...todos.filter((s) => !/outro/i.test(s.nome)).slice(0, 11), ...todos.filter((s) => /outro/i.test(s.nome))];
  const equipe = pode('demanda.ver');

  return (
    <div className="inicio">
      {equipe && (
        <div className="faixa-equipe">
          <span>Olá, <strong>{usuario?.nome.split(' ')[0]}</strong>. Área da equipe:</span>
          <a href="#/gestao/fila">Fila</a>
          {pode('painel.ver') && <a href="#/gestao/painel">Painel</a>}
          <a href="#/gestao/mapa">Mapa</a>
          {pode('demanda.registrar_assistido') && <a href="#/gestao/assistido">Atendimento assistido</a>}
          {pode('admin.usuarios') && <a href="#/admin">Administração</a>}
        </div>
      )}

      <section className="heroi">
        <div className="heroi-texto">
          <p className="heroi-sobre">Prefeitura Municipal de Sertânia · Pernambuco</p>
          <h1>Viu um problema na sua rua, distrito ou comunidade? Avise a prefeitura.</h1>
          <p>Registre em 2 minutos e acompanhe cada passo: quem recebeu, quem é o responsável, qual é o prazo e o que foi feito. Funciona no celular, mesmo com internet fraca.</p>
          <div className="linha">
            <a className="botao heroi-cta" href="#/nova">Registrar solicitação</a>
            <a className="botao sec heroi-sec" href="#/transparencia">Ver números do atendimento</a>
          </div>
        </div>
        <form className="heroi-acompanhar" onSubmit={(e) => { e.preventDefault(); acompanhar(); }}>
          <h2>Acompanhe sua solicitação</h2>
          <div className="campo"><label htmlFor="h-p">Protocolo</label><input id="h-p" value={protocolo} onChange={(e) => setProtocolo(e.target.value.toUpperCase())} placeholder="SER-2026-000123" autoComplete="off" /></div>
          <div className="campo"><label htmlFor="h-c">Código de acesso</label><input id="h-c" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="6 letras e números" autoComplete="off" /></div>
          <button className="botao" style={{ width: '100%' }} disabled={!protocolo || !codigo}>Consultar</button>
          <p className="ajuda">Os dois estão no comprovante que você recebeu ao registrar.</p>
        </form>
      </section>

      {!online && <Aviso tipo="alerta">Você está sem internet. Mesmo assim pode registrar: a solicitação fica guardada no aparelho e é enviada quando o sinal voltar.</Aviso>}
      {locais.pend > 0 && <Aviso tipo="alerta">{locais.pend} solicitação(ões) deste aparelho aguardando internet para envio.</Aviso>}
      {locais.env.length > 0 && (
        <Aviso tipo="ok">
          Enviadas quando o sinal voltou: {locais.env.map((e) => <span key={e.chave}> <strong>{e.protocolo}</strong> (código <code>{e.codigo}</code>)</span>)}
        </Aviso>
      )}

      {servicos.length > 0 && (
        <section className="bloco">
          <div className="linha entre"><h2>O que você precisa?</h2><a href="#/nova" className="pequeno">Ver todos os serviços →</a></div>
          <div className="atalhos">
            {servicos.map((s) => (
              <a key={s.id} className="atalho" href={`#/nova?servico=${s.id}`}>
                <span className="atalho-ic" aria-hidden="true">{icone(s.nome)}</span>
                <span className="atalho-nome">{s.nome}</span>
                <span className="atalho-prazo">até {s.prazoDiasUteis} dia{s.prazoDiasUteis > 1 ? 's' : ''} úte{s.prazoDiasUteis > 1 ? 'is' : 'il'}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="bloco">
        <h2>Como funciona</h2>
        <ol className="passos-como">
          <li><span className="n">1</span><strong>Registre</strong><span>Conte o que aconteceu, marque o local e, se puder, envie uma foto. Pode ser anônimo.</span></li>
          <li><span className="n">2</span><strong>Acompanhe</strong><span>Com o protocolo você vê para qual setor foi, o prazo e cada atualização da equipe.</span></li>
          <li><span className="n">3</span><strong>Avalie</strong><span>Quando concluída, diga se o problema foi resolvido. Sua nota ajuda a melhorar o serviço.</span></li>
        </ol>
      </section>

      {transp.dados && transp.dados.total > 0 && (
        <section className="bloco numeros">
          <div><span className="num-grande">{fmtNum(transp.dados.total, 0)}</span><span>solicitações nos últimos 90 dias</span></div>
          <div><span className="num-grande">{fmtNum(transp.dados.noPrazoPct, 0, '%')}</span><span>concluídas dentro do prazo</span></div>
          <div><span className="num-grande">{fmtNum(transp.dados.satisfacao, 1)}</span><span>de 5 na avaliação dos cidadãos</span></div>
          <a className="botao sec" href="#/transparencia">Transparência e dados abertos</a>
        </section>
      )}
      {instalacao?.demonstracao && <p className="ajuda" style={{ textAlign: 'center' }}>Ambiente de demonstração: números fictícios.</p>}

      <section className="grade g3 bloco">
        <div className="cartao">
          <h3>🧑‍💼 Prefere ser atendido por alguém?</h3>
          <p className="sec">Vá ao atendimento da Prefeitura, à ouvidoria ou ao posto do seu distrito, ou ligue. O servidor registra para você e entrega o protocolo impresso.</p>
        </div>
        <div className="cartao">
          <h3>📶 Internet fraca?</h3>
          <p className="sec">O site funciona com pouco sinal. Fotos são reduzidas no próprio celular e, sem conexão, o pedido espera e é enviado depois, sem duplicar.</p>
        </div>
        <div className="cartao">
          <h3>🔒 Seus dados protegidos</h3>
          <p className="sec">Usamos seus dados só para este atendimento (LGPD). A equipe de campo não vê seu telefone completo, e os relatórios não identificam ninguém.</p>
        </div>
      </section>

      {!usuario && (
        <p className="sec" style={{ textAlign: 'center' }}>
          Quer ver todas as suas solicitações em um só lugar? <a href="#/entrar">Crie uma conta</a> (opcional). · Servidor da prefeitura? <a href="#/entrar">Entre aqui</a>.
        </p>
      )}
    </div>
  );
}
