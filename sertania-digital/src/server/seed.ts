/**
 * Dados iniciais. TUDO aqui e DEMONSTRATIVO: secretarias, servicos, prazos,
 * coordenadas e demandas servem para exercitar a plataforma e devem ser
 * substituidos pelos dados levantados no diagnostico (item 6 do desafio).
 */
import type { Banco } from './db.js';
import { hashSenha, sha256 } from './auth.js';
import { auditar } from './auditoria.js';
import { gerarCodigo } from './demandas.js';
import { somarDiasUteis } from '../shared/sla.js';
import type { Canal, Prioridade, Resultado, Status } from '../shared/dominio.js';

interface ServicoSeed { nome: string; descricao: string; chaves: string; prazo: number; prioridade?: Prioridade; relatos: string[] }
const CATALOGO: Array<{ nome: string; sigla: string; setores: Array<{ nome: string; servicos: ServicoSeed[] }> }> = [
  {
    nome: 'Administração e Gestão de Pessoas', sigla: 'SAD',
    setores: [{ nome: 'Protocolo Geral', servicos: [{ nome: 'Outro assunto / não sei o setor', descricao: 'Quando você não encontrar o serviço, registre aqui que a equipe encaminha.', chaves: 'informacao duvida outro geral prefeitura', prazo: 3, relatos: ['Gostaria de saber qual setor cuida da praça do bairro', 'Preciso de informação sobre documentos da prefeitura'] }] }],
  },
  {
    nome: 'Infraestrutura e Obras', sigla: 'SEINFRA',
    setores: [
      { nome: 'Iluminação Pública', servicos: [{ nome: 'Lâmpada apagada ou poste com defeito', descricao: 'Iluminação pública apagada, piscando ou acesa de dia.', chaves: 'lampada poste luz iluminacao escuro apagada piscando refletor', prazo: 5, relatos: ['A lâmpada do poste em frente à minha casa está apagada há uma semana, a rua fica toda escura', 'Poste piscando a noite inteira perto da escola', 'Três postes apagados na rua, perigoso à noite', 'Luz do poste acesa durante o dia'] }] },
      { nome: 'Manutenção de Vias', servicos: [
        { nome: 'Buraco na rua ou calçamento danificado', descricao: 'Buracos, pedras soltas, calçamento afundado.', chaves: 'buraco calcamento asfalto pedra rua cratera pavimento afundou', prazo: 10, relatos: ['Buraco grande no meio da rua, carros desviando e quase batendo', 'Calçamento afundou depois da chuva', 'Pedras soltas no calçamento da rua principal', 'Cratera na esquina, moto caiu ontem'] },
      ] },
      { nome: 'Drenagem', servicos: [{ nome: 'Bueiro entupido ou alagamento', descricao: 'Galerias e bueiros entupidos, pontos de alagamento.', chaves: 'bueiro boca de lobo alagamento enchente agua parada esgoto galeria entupido', prazo: 7, prioridade: 'ALTA', relatos: ['Bueiro entupido, quando chove a rua alaga e a água entra nas casas', 'Esgoto a céu aberto correndo pela rua', 'Boca de lobo quebrada e entupida de lixo'] }] },
    ],
  },
  {
    nome: 'Meio Ambiente e Limpeza Urbana', sigla: 'SEMA',
    setores: [{ nome: 'Limpeza Urbana', servicos: [
      { nome: 'Coleta de lixo não realizada', descricao: 'Coleta domiciliar que não passou no dia previsto.', chaves: 'lixo coleta caminhao lixeiro recolher saco', prazo: 3, relatos: ['O caminhão do lixo não passa na rua há quatro dias', 'Coleta de lixo não foi feita esta semana', 'Lixo acumulado na porta das casas porque a coleta não passou'] },
      { nome: 'Entulho ou lixo acumulado em terreno', descricao: 'Descarte irregular, terreno baldio sujo.', chaves: 'entulho terreno baldio descarte irregular mato sujeira', prazo: 10, relatos: ['Terreno baldio cheio de entulho e mato alto, aparecendo ratos', 'Pessoas jogando lixo no terreno ao lado da praça'] },
      { nome: 'Poda ou remoção de árvore', descricao: 'Galhos sobre a fiação ou árvore com risco de queda.', chaves: 'arvore poda galho tronco caindo fiacao', prazo: 15, relatos: ['Galhos da árvore encostando na fiação elétrica', 'Árvore inclinada com risco de cair sobre a casa'] },
    ] }],
  },
  {
    nome: 'Saúde', sigla: 'SMS',
    setores: [
      { nome: 'Vigilância em Saúde', servicos: [
        { nome: 'Foco de mosquito da dengue / água parada', descricao: 'Locais com água parada e possível criadouro do Aedes.', chaves: 'dengue mosquito aedes agua parada foco criadouro piscina pneu', prazo: 5, prioridade: 'ALTA', relatos: ['Casa abandonada com piscina cheia de água parada, muito mosquito', 'Pneus acumulados com água no terreno, vários casos de dengue na rua'] },
        { nome: 'Escorpião ou animal peçonhento', descricao: 'Aparecimento frequente de escorpiões e outros animais.', chaves: 'escorpiao cobra aranha animal peconhento picada', prazo: 3, prioridade: 'ALTA', relatos: ['Muitos escorpiões aparecendo nas casas, criança quase foi picada', 'Apareceu escorpião dentro de casa três vezes esta semana'] },
      ] },
      { nome: 'Atenção Básica', servicos: [{ nome: 'Reclamação sobre atendimento em unidade de saúde', descricao: 'Falta de atendimento, demora, falta de medicamentos.', chaves: 'posto ubs medico atendimento remedio medicamento consulta enfermeira', prazo: 10, relatos: ['Posto de saúde sem médico há duas semanas', 'Falta de medicamento de pressão na UBS'] }] },
    ],
  },
  {
    nome: 'Educação', sigla: 'SEDUC',
    setores: [
      { nome: 'Transporte Escolar', servicos: [{ nome: 'Problema no transporte escolar', descricao: 'Ônibus que não passou, atrasos, veículo em más condições.', chaves: 'onibus transporte escolar aluno motorista escola rota', prazo: 3, prioridade: 'ALTA', relatos: ['O ônibus escolar não passou na comunidade e as crianças perderam aula', 'Transporte escolar com pneu careca e porta quebrada'] }] },
      { nome: 'Rede Física Escolar', servicos: [{ nome: 'Manutenção em escola', descricao: 'Telhado, banheiros, fiação, carteiras.', chaves: 'escola telhado goteira banheiro sala carteira reforma', prazo: 20, relatos: ['Telhado da escola com goteiras nas salas', 'Banheiro da escola quebrado'] }] },
    ],
  },
  {
    nome: 'Assistência Social', sigla: 'SEMAS',
    setores: [{ nome: 'CRAS', servicos: [{ nome: 'Pedido de visita ou atendimento social', descricao: 'Família em vulnerabilidade, idoso sozinho, cadastro social.', chaves: 'cras cadastro social familia vulnerabilidade idoso visita cesta bolsa', prazo: 5, relatos: ['Idosa morando sozinha precisando de acompanhamento', 'Família sem renda precisando de orientação para cadastro social'] }] }],
  },
  {
    nome: 'Agricultura e Recursos Hídricos', sigla: 'SEAGRI',
    setores: [
      { nome: 'Abastecimento Rural', servicos: [{ nome: 'Falta de água / carro-pipa na zona rural', descricao: 'Abastecimento por carro-pipa, cisternas e poços.', chaves: 'agua carro pipa cisterna poco seca abastecimento chafariz', prazo: 5, prioridade: 'ALTA', relatos: ['Comunidade sem água há dez dias, carro-pipa não veio', 'Cisterna da comunidade vazia', 'Poço comunitário com bomba quebrada'] }] },
      { nome: 'Estradas Vicinais', servicos: [{ nome: 'Estrada rural danificada', descricao: 'Estradas de terra com buracos, erosão ou bloqueadas.', chaves: 'estrada rural terra vicinal erosao atoleiro passagem ponte', prazo: 20, relatos: ['Estrada de terra com valetas depois da chuva, carro não passa', 'Passagem molhada destruída na estrada da comunidade'] }] },
    ],
  },
];

/** Coordenadas APROXIMADAS: devem ser conferidas pela prefeitura no cadastro de localidades. */
const LOCALIDADES: Array<[string, 'SEDE' | 'DISTRITO' | 'COMUNIDADE_RURAL', number, number]> = [
  ['Sertânia (sede)', 'SEDE', -8.0733, -37.2646],
  ['Albuquerque Né', 'DISTRITO', -8.1550, -37.0700],
  ['Henrique Dias', 'DISTRITO', -8.2050, -37.3900],
  ['Moderna', 'DISTRITO', -7.9650, -37.1900],
  ['Rio da Barra', 'DISTRITO', -8.0200, -37.4300],
  ['Comunidade rural Norte (exemplo)', 'COMUNIDADE_RURAL', -7.9900, -37.3000],
  ['Comunidade rural Sul (exemplo)', 'COMUNIDADE_RURAL', -8.1500, -37.2400],
  ['Comunidade rural Leste (exemplo)', 'COMUNIDADE_RURAL', -8.0700, -37.1300],
];

const FERIADOS: Array<[string, string]> = [
  ['2026-01-01', 'Confraternização Universal'], ['2026-03-06', 'Revolução Pernambucana (data magna de PE)'], ['2026-04-03', 'Sexta-feira Santa'],
  ['2026-04-21', 'Tiradentes'], ['2026-05-01', 'Dia do Trabalho'], ['2026-06-04', 'Corpus Christi'], ['2026-06-24', 'São João'],
  ['2026-09-07', 'Independência'], ['2026-10-12', 'Nossa Senhora Aparecida'], ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'],
  ['2026-11-20', 'Consciência Negra'], ['2026-12-25', 'Natal'],
];

export const SENHA_DEMO = 'Sertania2026';

/** Gerador pseudoaleatorio deterministico: o mesmo seed gera os mesmos dados. */
function prng(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function semear(banco: Banco, opcoes: { demonstracao: boolean; quantidade?: number }): void {
  banco.tx(() => {
    const servicos: Array<{ id: number; setorId: number; secretariaId: number; prazo: number; prioridade: Prioridade; relatos: string[]; sigla: string; setor: string }> = [];
    const setores = new Map<string, number>();
    const secretarias = new Map<string, number>();
    for (const sc of CATALOGO) {
      const { id: scId } = banco.run('INSERT INTO secretarias (nome, sigla) VALUES (?,?)', sc.nome, sc.sigla);
      secretarias.set(sc.sigla, scId);
      for (const st of sc.setores) {
        const { id: stId } = banco.run('INSERT INTO setores (secretaria_id, nome) VALUES (?,?)', scId, st.nome);
        setores.set(st.nome, stId);
        for (const sv of st.servicos) {
          const { id } = banco.run(
            'INSERT INTO servicos (setor_id, nome, descricao, palavras_chave, prazo_dias_uteis, prioridade_padrao) VALUES (?,?,?,?,?,?)',
            stId, sv.nome, sv.descricao, sv.chaves, sv.prazo, sv.prioridade ?? 'NORMAL',
          );
          servicos.push({ id, setorId: stId, secretariaId: scId, prazo: sv.prazo, prioridade: sv.prioridade ?? 'NORMAL', relatos: sv.relatos, sigla: sc.sigla, setor: st.nome });
        }
      }
    }
    const locs = LOCALIDADES.map(([nome, tipo, lat, lng]) => ({ id: banco.run('INSERT INTO localidades (nome, tipo, lat, lng) VALUES (?,?,?,?)', nome, tipo, lat, lng).id, nome, tipo, lat, lng }));
    for (const [data, nome] of FERIADOS) banco.run('INSERT INTO feriados (data, nome) VALUES (?,?)', data, nome);

    if (!opcoes.demonstracao) return;

    const senha = hashSenha(SENHA_DEMO);
    const usuarios: Array<[string, string, string, string | null, string | null]> = [
      ['Ana Administração (SAD)', 'admin@sertania.demo', 'ADMIN_SAD', 'SAD', null],
      ['Bruno Atendimento', 'atendimento@sertania.demo', 'ATENDENTE', 'SAD', 'Protocolo Geral'],
      ['Carla Gestora de Infraestrutura', 'gestor.infra@sertania.demo', 'GESTOR_SECRETARIA', 'SEINFRA', null],
      ['Diego Gestor de Iluminação', 'gestor.iluminacao@sertania.demo', 'GESTOR_SETOR', 'SEINFRA', 'Iluminação Pública'],
      ['Edson Equipe de Iluminação', 'campo.iluminacao@sertania.demo', 'CAMPO', 'SEINFRA', 'Iluminação Pública'],
      ['Fábio Equipe de Vias', 'campo.vias@sertania.demo', 'CAMPO', 'SEINFRA', 'Manutenção de Vias'],
      ['Gabriela Gestora de Saúde', 'gestor.saude@sertania.demo', 'GESTOR_SECRETARIA', 'SMS', null],
      ['Helena Controle Interno', 'auditor@sertania.demo', 'AUDITOR', null, null],
      ['Iara Cidadã', 'cidadao@sertania.demo', 'CIDADAO', null, null],
    ];
    const ids: Record<string, number> = {};
    for (const [nome, email, papel, sigla, setor] of usuarios) {
      ids[email] = banco.run(
        'INSERT INTO usuarios (nome, email, senha_hash, papel, secretaria_id, setor_id, consentimento_em) VALUES (?,?,?,?,?,?,?)',
        nome, email, senha, papel, sigla ? secretarias.get(sigla)! : null, setor ? setores.get(setor)! : null, papel === 'CIDADAO' ? new Date().toISOString() : null,
      ).id;
    }
    const equipePorSetor = new Map<number, number[]>();
    for (const [, email, papel, , setor] of usuarios)
      if (setor && (papel === 'CAMPO' || papel === 'GESTOR_SETOR')) equipePorSetor.set(setores.get(setor)!, [...(equipePorSetor.get(setores.get(setor)!) ?? []), ids[email]!]);

    // ---------------------------------------------------------------- demandas historicas
    const rnd = prng(2026);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const feriadosSet = new Set(FERIADOS.map(([d]) => d));
    const agora = Date.now();
    const nomes = ['Maria', 'José', 'Antônio', 'Francisca', 'João', 'Ana', 'Luiz', 'Josefa', 'Paulo', 'Rita', 'Severino', 'Lúcia'];
    const sobrenomes = ['Silva', 'Souza', 'Ferreira', 'Lima', 'Alves', 'Pereira', 'Santos', 'Oliveira'];
    const ruas = ['Rua da Matriz', 'Rua São José', 'Av. Coronel Né', 'Rua do Comércio', 'Travessa da Feira', 'Rua Nova', 'Rua do Cruzeiro'];
    const canais: Canal[] = ['APP', 'APP', 'APP', 'PRESENCIAL', 'TELEFONE', 'WHATSAPP', 'OUVIDORIA'];
    const qtd = opcoes.quantidade ?? 220;
    // Pontos de recorrencia proposital (mesmo local, mesmo servico)
    const focos = [
      { servico: servicos.find((s) => s.setor === 'Manutenção de Vias')!, loc: locs[3]!, dLat: 0.0004, dLng: 0.0003, n: 6 },
      { servico: servicos.find((s) => s.setor === 'Iluminação Pública')!, loc: locs[0]!, dLat: 0.0021, dLng: -0.0012, n: 5 },
      { servico: servicos.find((s) => s.setor === 'Abastecimento Rural')!, loc: locs[5]!, dLat: 0.0002, dLng: 0.0001, n: 4 },
      { servico: servicos.find((s) => s.setor === 'Drenagem')!, loc: locs[0]!, dLat: -0.0016, dLng: 0.0019, n: 4 },
    ];
    const plano: Array<{ servico: (typeof servicos)[number]; loc: (typeof locs)[number]; lat: number; lng: number }> = [];
    for (const f of focos) for (let i = 0; i < f.n; i++) plano.push({ servico: f.servico, loc: f.loc, lat: f.loc.lat + f.dLat + (rnd() - 0.5) * 0.0006, lng: f.loc.lng + f.dLng + (rnd() - 0.5) * 0.0006 });
    while (plano.length < qtd) {
      const loc = rnd() < 0.55 ? locs[0]! : pick(locs);
      const rurais = ['Abastecimento Rural', 'Estradas Vicinais'];
      const elegiveis = loc.tipo === 'COMUNIDADE_RURAL' ? servicos.filter((s) => rurais.includes(s.setor) || rnd() < 0.3) : servicos.filter((s) => !rurais.includes(s.setor) || rnd() < 0.15);
      const raio = loc.tipo === 'SEDE' ? 0.012 : 0.006;
      plano.push({ servico: pick(elegiveis), loc, lat: loc.lat + (rnd() - 0.5) * raio, lng: loc.lng + (rnd() - 0.5) * raio });
    }

    let seq = 0;
    const criadas: Array<{ id: number; criada: number }> = [];
    for (const p of plano) {
      seq++;
      const criada = agora - Math.floor(rnd() * 120 * 86400000) - 3600000;
      const sv = p.servico;
      const relato = pick(sv.relatos);
      const anonima = rnd() < 0.12;
      const nome = `${pick(nomes)} ${pick(sobrenomes)}`;
      const canal = pick(canais);
      const prazo = somarDiasUteis(new Date(criada), sv.prazo, feriadosSet).getTime();
      const idade = agora - criada;
      // Destino: quanto mais antiga, mais provavel estar concluida.
      const r = rnd();
      let status: Status;
      if (idade > 30 * 86400000) status = r < 0.78 ? 'CONCLUIDA' : r < 0.85 ? 'CANCELADA' : r < 0.92 ? 'EM_EXECUCAO' : 'IMPEDIDA';
      else if (idade > 7 * 86400000) status = r < 0.45 ? 'CONCLUIDA' : r < 0.55 ? 'AGENDADA' : r < 0.72 ? 'EM_EXECUCAO' : r < 0.8 ? 'AGUARDANDO_CIDADAO' : r < 0.9 ? 'ENCAMINHADA' : 'IMPEDIDA';
      else status = r < 0.35 ? 'RECEBIDA' : r < 0.65 ? 'ENCAMINHADA' : r < 0.8 ? 'EM_EXECUCAO' : r < 0.9 ? 'AGENDADA' : 'CONCLUIDA';
      const tEnc = criada + Math.floor((0.5 + rnd() * 30) * 3600000);
      const encaminhada = status === 'RECEBIDA' ? null : Math.min(tEnc, agora - 60000);
      const fator = 0.3 + rnd() * 1.3; // concluidas: parte dentro, parte fora do prazo
      const fim = status === 'CONCLUIDA' || status === 'CANCELADA' ? Math.min(criada + (prazo - criada) * fator, agora - 60000) : null;
      const resultado: Resultado | null = status === 'CONCLUIDA' ? (rnd() < 0.86 ? 'RESOLVIDA' : pick(['IMPROCEDENTE', 'DUPLICADA', 'FORA_DE_COMPETENCIA'] as const)) : null;
      const equipe = equipePorSetor.get(sv.setorId);
      const responsavel = encaminhada && equipe && rnd() < 0.8 ? pick(equipe) : null;
      const nota = status === 'CONCLUIDA' && rnd() < 0.55 ? (resultado === 'RESOLVIDA' ? pick([3, 4, 4, 5, 5, 5]) : pick([1, 2, 3])) : null;
      const pausada = status === 'AGUARDANDO_CIDADAO' ? new Date(Math.max(encaminhada ?? criada, agora - 3 * 86400000)).toISOString() : null;
      const prioridade: Prioridade = /criança|perigoso|risco|casas|moto caiu/.test(relato) ? (sv.prioridade === 'ALTA' ? 'URGENTE' : 'ALTA') : sv.prioridade;
      const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
      const ano = new Date(criada).getFullYear();
      banco.run('INSERT INTO contadores (chave, valor) VALUES (?, 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1', `protocolo-${ano}`);
      const n = banco.get<{ valor: number }>('SELECT valor FROM contadores WHERE chave = ?', `protocolo-${ano}`)!.valor;
      const protocolo = `SER-${ano}-${String(n).padStart(6, '0')}`;
      const { id } = banco.run(
        `INSERT INTO demandas (protocolo, codigo_hash, servico_id, setor_id, secretaria_id, status, status_anterior, prioridade, descricao, endereco, referencia,
          localidade_id, lat, lng, canal, solicitante_id, solicitante_nome, solicitante_telefone, anonima, responsavel_id, criada_em, encaminhada_em,
          primeira_resposta_em, concluida_em, prazo_em, pausada_desde, resultado, avaliacao_nota, agendada_para)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        protocolo, sha256(seq === 1 ? 'DEMO01' : gerarCodigo()), sv.id, sv.setorId, sv.secretariaId, status, status === 'AGUARDANDO_CIDADAO' ? 'EM_EXECUCAO' : null,
        prioridade, relato, p.loc.tipo === 'COMUNIDADE_RURAL' ? null : `${pick(ruas)}, ${Math.floor(rnd() * 900) + 10}`, rnd() < 0.4 ? 'Próximo à igreja' : null,
        p.loc.id, Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6, canal,
        seq % 9 === 0 ? ids['cidadao@sertania.demo']! : null, anonima ? null : seq % 9 === 0 ? 'Iara Cidadã' : nome,
        anonima ? null : `(87) 9${Math.floor(rnd() * 9000 + 1000)}-${Math.floor(rnd() * 9000 + 1000)}`, anonima, responsavel,
        iso(criada), iso(encaminhada), iso(encaminhada), iso(fim), iso(prazo), pausada, resultado, nota,
        status === 'AGENDADA' ? iso(agora + Math.floor(rnd() * 7 + 1) * 86400000) : null,
      );
      criadas.push({ id, criada });
      const ev = (tipo: string, de: Status | null, para: Status, quando: number, texto: string | null, autor = 'Sistema') =>
        banco.run('INSERT INTO eventos (demanda_id, tipo, de_status, para_status, texto_publico, autor_nome, criado_em) VALUES (?,?,?,?,?,?,?)', id, tipo, de, para, texto, autor, new Date(quando).toISOString());
      ev('ABERTURA', null, 'RECEBIDA', criada, `Solicitação registrada pelo canal: ${canal.toLowerCase()}. Protocolo ${protocolo}.`, anonima ? 'Cidadão' : nome);
      if (encaminhada) ev('ENCAMINHAR', 'RECEBIDA', 'ENCAMINHADA', encaminhada, `Solicitação encaminhada para ${sv.setor}.`, 'Bruno Atendimento');
      if (['EM_EXECUCAO', 'IMPEDIDA', 'AGUARDANDO_CIDADAO', 'CONCLUIDA'].includes(status) && encaminhada) ev('INICIAR_EXECUCAO', 'ENCAMINHADA', 'EM_EXECUCAO', encaminhada + 3600000 * 12, 'A equipe iniciou o atendimento.', 'Equipe');
      if (status === 'IMPEDIDA') ev('REGISTRAR_IMPEDIMENTO', 'EM_EXECUCAO', 'IMPEDIDA', (encaminhada ?? criada) + 86400000, 'Aguardando material para concluir o serviço.', 'Equipe');
      if (status === 'AGUARDANDO_CIDADAO') ev('SOLICITAR_INFO', 'EM_EXECUCAO', 'AGUARDANDO_CIDADAO', Date.parse(pausada!), 'Pode informar um ponto de referência mais preciso?', 'Equipe');
      if (status === 'AGENDADA') ev('AGENDAR', 'ENCAMINHADA', 'AGENDADA', (encaminhada ?? criada) + 86400000, 'Atendimento agendado.', 'Equipe');
      if (status === 'CONCLUIDA' && fim) ev('CONCLUIR', 'EM_EXECUCAO', 'CONCLUIDA', fim, resultado === 'RESOLVIDA' ? 'Serviço realizado pela equipe.' : 'Solicitação encerrada após análise.', 'Equipe');
      if (status === 'CANCELADA' && fim) ev('CANCELAR', 'ENCAMINHADA', 'CANCELADA', fim, 'Cancelada a pedido do solicitante.', 'Equipe');
    }
    // Recorrencia: aponta cada demanda do foco para a mais antiga no mesmo raio (feito depois, pela ordem cronologica).
    criadas.sort((a, b) => a.criada - b.criada);
    banco.run("INSERT INTO contadores (chave, valor) VALUES ('seed-demo', 1)");
    auditar(banco, { id: null, nome: 'Sistema' }, 'SEED_DEMONSTRACAO', null, null, { demandas: plano.length });
  });
}
