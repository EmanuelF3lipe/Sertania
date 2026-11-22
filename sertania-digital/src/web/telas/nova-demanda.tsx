import { useEffect, useMemo, useState } from 'react';
import { CANAIS, CANAL_TEXTO, type Canal, type SugestaoClassificacao } from '../../shared/dominio';
import { comprimirImagem, enviarFormulario, post, ErroApi } from '../api';
import { ir, useEstado, useOnline, useRota } from '../nucleo';
import { Aviso, Copiar } from '../componentes/comuns';
import { Mapa } from '../componentes/mapa';
import { guardar } from '../offline';

interface Comprovante { protocolo: string; codigo: string; offline?: boolean }

/** Formulario em passos curtos, linguagem simples, usavel no celular e em atendimento assistido. */
export function NovaDemanda({ assistido = false }: { assistido?: boolean }) {
  const { catalogo, usuario } = useEstado();
  const { query } = useRota();
  const online = useOnline();
  const [passo, setPasso] = useState(1);
  const [descricao, setDescricao] = useState('');
  const [sugestoes, setSugestoes] = useState<SugestaoClassificacao[]>([]);
  const [servicoId, setServicoId] = useState<number | null>(() => (query.get('servico') ? Number(query.get('servico')) : null));
  const [secretariaFiltro, setSecretariaFiltro] = useState<number | null>(null);
  const [localidadeId, setLocalidadeId] = useState<number | null>(null);
  const [ponto, setPonto] = useState<{ lat: number; lng: number } | null>(null);
  const [endereco, setEndereco] = useState('');
  const [referencia, setReferencia] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [anonima, setAnonima] = useState(false);
  const [nome, setNome] = useState(usuario?.papel === 'CIDADAO' ? usuario.nome : '');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState(usuario?.papel === 'CIDADAO' ? usuario.email : '');
  const [consentimento, setConsentimento] = useState(false);
  const [canal, setCanal] = useState<Canal>('PRESENCIAL');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [gps, setGps] = useState<string | null>(null);
  const [comprovante, setComprovante] = useState<Comprovante | null>(null);

  // Sugestao de servico enquanto a pessoa escreve (IA local, nada e gravado).
  useEffect(() => {
    if (descricao.trim().length < 12 || !online) return;
    const t = setTimeout(() => {
      post<SugestaoClassificacao[]>('/publico/sugerir-servico', { texto: descricao }).then(setSugestoes).catch(() => undefined);
    }, 450);
    return () => clearTimeout(t);
  }, [descricao, online]);

  const servico = catalogo?.servicos.find((s) => s.id === servicoId) ?? null;
  const localidade = catalogo?.localidades.find((l) => l.id === localidadeId) ?? null;
  const centro = useMemo<[number, number] | undefined>(() => (localidade ? [localidade.lat, localidade.lng] : undefined), [localidade]);

  if (!catalogo) return <p>Carregando serviços…</p>;
  const secretaria = (id: number) => catalogo.secretarias.find((s) => s.id === id)?.nome ?? '';

  if (comprovante) return <TelaComprovante c={comprovante} assistido={assistido} />;

  const usarGps = () => {
    if (!navigator.geolocation) return setGps('Seu aparelho não permite localização.');
    setGps('Buscando sua localização…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPonto({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGps(`Localização marcada (precisão de ~${Math.round(p.coords.accuracy)} m).`);
      },
      () => setGps('Não foi possível obter a localização. Marque no mapa ou escolha a localidade.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const avancar = () => {
    setErro(null);
    if (passo === 1 && descricao.trim().length < 10) return setErro('Conte com um pouco mais de detalhe o que aconteceu (pelo menos 10 letras).');
    if (passo === 2 && !servicoId) return setErro('Escolha o tipo de serviço. Se não souber, escolha "Outro assunto / não sei o setor".');
    if (passo === 3 && !localidadeId && !ponto) return setErro('Diga onde é: escolha a localidade ou marque no mapa.');
    setPasso(passo + 1);
  };

  const enviar = async () => {
    setErro(null);
    if (!assistido && !anonima && !consentimento) return setErro('Para registrar com seus dados, marque que concorda com o uso deles para este atendimento.');
    if (assistido && !anonima && !nome.trim()) return setErro('Informe o nome do cidadão ou marque como anônima.');
    const dados = {
      servicoId, descricao, localidadeId, lat: ponto?.lat ?? null, lng: ponto?.lng ?? null, endereco, referencia, anonima,
      nome: anonima ? null : nome, telefone: anonima ? null : telefone, email: anonima ? null : email, consentimento: assistido || consentimento,
      chaveIdempotencia: crypto.randomUUID(), ...(assistido ? { canal } : {}),
    };
    setEnviando(true);
    try {
      const r = await enviarFormulario<Comprovante>(assistido ? '/gestao/demandas' : '/publico/demandas', dados, arquivos);
      setComprovante(r);
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'offline' && !assistido) {
        await guardar(dados, arquivos);
        setComprovante({ protocolo: '', codigo: '', offline: true });
      } else setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const servicosVisiveis = catalogo.servicos.filter((s) => !secretariaFiltro || s.secretariaId === secretariaFiltro);

  return (
    <div className="estreito">
      <h1>{assistido ? 'Atendimento assistido' : 'Registrar uma solicitação'}</h1>
      <p className="sec">
        {assistido ? 'Registre o pedido de quem procurou a prefeitura pessoalmente, por telefone, WhatsApp ou ouvidoria.' : 'Leva cerca de 2 minutos. Você recebe um número de protocolo para acompanhar.'}
      </p>
      <ol className="passos" aria-label={`Passo ${passo} de 5`}>
        {[1, 2, 3, 4, 5].map((n) => <li key={n} className={n <= passo ? 'feito' : ''} />)}
      </ol>
      {!online && <Aviso tipo="alerta">Você está sem internet. Pode preencher normalmente: guardamos no aparelho e enviamos quando o sinal voltar.</Aviso>}

      <div className="cartao">
        {passo === 1 && (
          <>
            <h2>1. O que está acontecendo?</h2>
            {assistido && (
              <div className="campo">
                <label htmlFor="canal">Canal do atendimento</label>
                <select id="canal" value={canal} onChange={(e) => setCanal(e.target.value as Canal)}>
                  {CANAIS.filter((c) => c !== 'APP').map((c) => <option key={c} value={c}>{CANAL_TEXTO[c]}</option>)}
                </select>
              </div>
            )}
            <div className="campo">
              <label htmlFor="desc">Descreva o problema com suas palavras</label>
              <textarea id="desc" value={descricao} maxLength={4000} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: A lâmpada do poste em frente à minha casa está apagada há uma semana." />
              <div className="ajuda">Não escreva CPF ou dados de outras pessoas aqui.</div>
            </div>
          </>
        )}

        {passo === 2 && (
          <>
            <h2>2. Qual é o tipo de serviço?</h2>
            {sugestoes.length > 0 && (
              <div className="campo">
                <label>Sugestões pelo que você escreveu</label>
                <div className="coluna">
                  {sugestoes.map((s) => (
                    <button key={s.servicoId} type="button" className={`botao ${servicoId === s.servicoId ? '' : 'sec'}`} style={{ justifyContent: 'flex-start' }} onClick={() => setServicoId(s.servicoId)} aria-pressed={servicoId === s.servicoId}>
                      {servicoId === s.servicoId ? '✓ ' : ''}{s.servico} <span className="pequeno" style={{ fontWeight: 400 }}>– {s.secretaria}</span>
                    </button>
                  ))}
                </div>
                <div className="ajuda">Sugestão automática. Confira e escolha a opção certa — a equipe da prefeitura também revisa.</div>
              </div>
            )}
            <div className="campo">
              <label htmlFor="sec">Ou procure por secretaria</label>
              <select id="sec" value={secretariaFiltro ?? ''} onChange={(e) => setSecretariaFiltro(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todas as secretarias</option>
                {catalogo.secretarias.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="srv">Serviço</label>
              <select id="srv" value={servicoId ?? ''} onChange={(e) => setServicoId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Escolha…</option>
                {servicosVisiveis.map((s) => <option key={s.id} value={s.id}>{s.nome} — {secretaria(s.secretariaId)}</option>)}
              </select>
              {servico && <div className="ajuda">{servico.descricao} Prazo de referência: {servico.prazoDiasUteis} dia(s) útil(eis).</div>}
            </div>
          </>
        )}

        {passo === 3 && (
          <>
            <h2>3. Onde é?</h2>
            <div className="campo">
              <label htmlFor="loc">Localidade</label>
              <select id="loc" value={localidadeId ?? ''} onChange={(e) => setLocalidadeId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Escolha a sede, distrito ou comunidade…</option>
                {(['SEDE', 'DISTRITO', 'COMUNIDADE_RURAL'] as const).map((t) => (
                  <optgroup key={t} label={t === 'SEDE' ? 'Sede' : t === 'DISTRITO' ? 'Distritos' : 'Comunidades rurais'}>
                    {catalogo.localidades.filter((l) => l.tipo === t).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="linha campo">
              <button type="button" className="botao sec" onClick={usarGps}>📍 Usar minha localização</button>
              {ponto && <button type="button" className="botao sec peq" onClick={() => setPonto(null)}>Remover ponto</button>}
            </div>
            {gps && <p className="pequeno sec">{gps}</p>}
            {online ? (
              <>
                <p className="ajuda">Ou toque no mapa para marcar o local exato (opcional).</p>
                <Mapa baixo selecao={ponto} aoSelecionar={setPonto} centro={centro} zoom={localidade ? 14 : 11} />
              </>
            ) : (
              <p className="ajuda">Sem internet o mapa não carrega; a localidade e o endereço são suficientes.</p>
            )}
            <div className="grade g2" style={{ marginTop: 12 }}>
              <div className="campo">
                <label htmlFor="end">Endereço (se houver)</label>
                <input id="end" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua e número" />
              </div>
              <div className="campo">
                <label htmlFor="ref">Ponto de referência</label>
                <input id="ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: perto da escola, do açude…" />
              </div>
            </div>
          </>
        )}

        {passo === 4 && (
          <>
            <h2>4. Fotos ou documentos (opcional)</h2>
            <p className="sec">Uma foto ajuda a equipe a entender o problema. Até 5 arquivos (foto ou PDF).</p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              capture="environment"
              multiple
              onChange={async (e) => {
                const lista = Array.from(e.target.files ?? []).slice(0, 5 - arquivos.length);
                const prontos = await Promise.all(lista.map((f) => comprimirImagem(f)));
                setArquivos((a) => [...a, ...prontos].slice(0, 5));
                e.target.value = '';
              }}
            />
            <div className="miniaturas" style={{ marginTop: 10 }}>
              {arquivos.map((a, i) => (
                <figure key={i}>
                  {a.type.startsWith('image/') ? <img src={URL.createObjectURL(a)} alt={a.name} /> : <span>📄</span>}
                  <figcaption>{(a.size / 1024).toFixed(0)} KB <button type="button" className="botao sec peq" onClick={() => setArquivos(arquivos.filter((_, j) => j !== i))} aria-label={`Remover ${a.name}`}>✕</button></figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        {passo === 5 && (
          <>
            <h2>5. Seus dados e revisão</h2>
            <label className="check campo">
              <input type="checkbox" checked={anonima} onChange={(e) => setAnonima(e.target.checked)} />
              <span>Registrar de forma <strong>anônima</strong>. {assistido ? '' : 'Você ainda acompanha pelo protocolo e código, mas não recebe avisos.'}</span>
            </label>
            {!anonima && (
              <div className="grade g2">
                <div className="campo">
                  <label htmlFor="nome">Nome</label>
                  <input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
                </div>
                <div className="campo">
                  <label htmlFor="tel">Telefone / WhatsApp</label>
                  <input id="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="(87) 9…" />
                </div>
                <div className="campo">
                  <label htmlFor="email">E-mail (opcional)</label>
                  <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
              </div>
            )}
            {!anonima && !assistido && (
              <label className="check campo">
                <input type="checkbox" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} />
                <span>Concordo que a Prefeitura use meus dados <strong>somente para este atendimento</strong> e para me avisar sobre ele (LGPD). Depois de encerrado, os dados pessoais são removidos conforme a política de retenção.</span>
              </label>
            )}
            <hr />
            <dl className="pequeno">
              <dt className="mudo">Serviço</dt><dd>{servico?.nome} — {servico ? secretaria(servico.secretariaId) : ''}</dd>
              <dt className="mudo">Local</dt><dd>{[localidade?.nome, endereco, referencia].filter(Boolean).join(' · ') || 'Ponto marcado no mapa'}{ponto ? ' (com coordenadas)' : ''}</dd>
              <dt className="mudo">Descrição</dt><dd>{descricao}</dd>
              <dt className="mudo">Anexos</dt><dd>{arquivos.length || 'nenhum'}</dd>
            </dl>
          </>
        )}

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="linha entre" style={{ marginTop: 16 }}>
          {passo > 1 ? <button type="button" className="botao sec" onClick={() => setPasso(passo - 1)}>← Voltar</button> : <span />}
          {passo < 5 ? (
            <button type="button" className="botao" onClick={avancar}>Continuar →</button>
          ) : (
            <button type="button" className="botao" disabled={enviando} onClick={() => void enviar()}>{enviando ? 'Enviando…' : online ? 'Enviar solicitação' : 'Guardar e enviar depois'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TelaComprovante({ c, assistido }: { c: Comprovante; assistido: boolean }) {
  if (c.offline)
    return (
      <div className="estreito cartao">
        <h1>Guardado no seu aparelho</h1>
        <p>Sem internet agora. Assim que o sinal voltar, enviamos sua solicitação automaticamente e o protocolo aparece em <a href="#/acompanhar">Acompanhar</a>.</p>
        <p className="sec">Não é preciso preencher de novo — reenviar não cria duplicata.</p>
        <a className="botao" href="#/">Voltar ao início</a>
      </div>
    );
  const texto = `Prefeitura de Sertânia – Protocolo ${c.protocolo} – Código de acesso ${c.codigo}`;
  return (
    <div className="estreito cartao">
      <h1>✓ Solicitação registrada</h1>
      <p>{assistido ? 'Entregue estes dados ao cidadão (impresso ou por mensagem).' : 'Guarde estes dados. Com eles você acompanha o andamento, responde perguntas da equipe e avalia o atendimento.'}</p>
      <div className="grade g2" style={{ margin: '16px 0' }}>
        <div><div className="mudo pequeno">Protocolo</div><div className="protocolo">{c.protocolo}</div></div>
        <div><div className="mudo pequeno">Código de acesso</div><div className="codigo">{c.codigo}</div></div>
      </div>
      <Aviso>O código de acesso não pode ser recuperado. Anote, tire um print ou imprima.</Aviso>
      <div className="linha nao-imprimir">
        <button className="botao" onClick={() => window.print()}>🖨 Imprimir comprovante</button>
        <Copiar texto={texto} rotulo="Copiar dados" />
        {'share' in navigator && <button className="botao sec" onClick={() => void navigator.share({ title: 'Protocolo Sertânia', text: texto })}>Compartilhar</button>}
        <button className="botao sec" onClick={() => ir(assistido ? '/gestao/fila' : `/acompanhar?protocolo=${c.protocolo}`)}>{assistido ? 'Ir para a fila' : 'Acompanhar agora'}</button>
      </div>
    </div>
  );
}
