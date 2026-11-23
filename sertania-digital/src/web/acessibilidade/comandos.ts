/**
 * Comandos de voz e ditado: so funcoes puras (sem window), para poderem ser testadas.
 * Quem nao pode usar teclado nem mouse fala o que quer fazer; aqui a frase vira uma acao.
 */

export type Comando =
  | { tipo: 'ir'; destino: string }
  | { tipo: 'clicar'; alvo: string }
  | { tipo: 'numero'; n: number }
  | { tipo: 'numeros' }
  | { tipo: 'esconderNumeros' }
  | { tipo: 'rolar'; direcao: 'baixo' | 'cima' | 'topo' | 'fim' }
  | { tipo: 'voltar' }
  | { tipo: 'ler' }
  | { tipo: 'parar' }
  | { tipo: 'escrever'; texto: string }
  | { tipo: 'apagarCampo' }
  | { tipo: 'campo'; direcao: 'proximo' | 'anterior' }
  | { tipo: 'preferencia'; acao: 'letraMaior' | 'letraMenor' | 'contraste' | 'escuro' | 'claro' }
  | { tipo: 'painel' }
  | { tipo: 'ajuda' }
  | { tipo: 'desligar' }
  | { tipo: 'desconhecido'; frase: string };

/** minusculas, sem acento, sem pontuacao nas pontas e espacos simples */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Destinos que a pessoa pode pedir por voz (ja normalizados) */
const DESTINOS: Array<[RegExp, string]> = [
  [/^(o )?(inicio|pagina inicial|comeco|principal|home)$/, '/'],
  [/^(registrar|nova solicitacao|registrar (uma )?solicitacao|fazer (um )?pedido|novo pedido|reclamar|pedir)$/, '/nova'],
  [/^(acompanhar|consultar|consultar protocolo|meu protocolo|protocolo)$/, '/acompanhar'],
  [/^(transparencia|numeros)$/, '/transparencia'],
  [/^(entrar|login|fazer login)$/, '/entrar'],
  [/^(acessibilidade|recursos de acessibilidade)$/, '/acessibilidade'],
  [/^(minhas|minhas solicitacoes|meus pedidos)$/, '/minhas'],
  [/^(area da equipe|meu dia|equipe)$/, '/equipe'],
  [/^(fila|fila de solicitacoes)$/, '/gestao/fila'],
  [/^(indicadores|painel)$/, '/gestao/painel'],
  [/^(mapa|mapa do municipio)$/, '/gestao/mapa'],
  [/^(alertas|alertas e ia)$/, '/gestao/alertas'],
  [/^(relatorios)$/, '/gestao/relatorios'],
  [/^(configuracoes|configuracao)$/, '/config'],
];
export function destinoDe(nome: string): string | null {
  const n = normalizar(nome).replace(/^(a|o|as|os|para|pra|pro) /, '');
  return DESTINOS.find(([r]) => r.test(n))?.[1] ?? null;
}

const NUMEROS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
};
export function lerNumero(s: string): number | null {
  const t = normalizar(s);
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return NUMEROS[t] ?? null;
}

export function interpretarComando(frase: string): Comando {
  const f = normalizar(frase);
  if (!f) return { tipo: 'desconhecido', frase };
  let m: RegExpMatchArray | null;

  if (/^(parar|pare|para|silencio|calar|cala a boca|chega)( de ler| leitura)?$/.test(f)) return { tipo: 'parar' };
  if (/^(desligar|desativar|parar de ouvir|parar comandos|desligar (os )?comandos( de voz)?|desligar microfone)$/.test(f)) return { tipo: 'desligar' };
  if (/^(ajuda|socorro|comandos|quais (sao )?(os )?comandos|o que (eu )?posso (falar|dizer))$/.test(f)) return { tipo: 'ajuda' };
  if (/^(ler|leia|ler (a )?(pagina|tela)|leia (a )?(pagina|tela)|ler tudo)$/.test(f)) return { tipo: 'ler' };
  if (/^(mostrar|mostre|exibir) (os )?numeros$|^numeros$/.test(f)) return { tipo: 'numeros' };
  if (/^(esconder|esconda|ocultar|tirar) (os )?numeros$/.test(f)) return { tipo: 'esconderNumeros' };
  if (/^(abrir |abre )?(o )?(painel|menu) de acessibilidade$/.test(f)) return { tipo: 'painel' };

  if ((m = f.match(/^(numero|clicar (no )?numero|clique (no )?numero|botao) (.+)$/))) {
    const n = lerNumero(m[4]!);
    if (n) return { tipo: 'numero', n };
  }
  const soNumero = lerNumero(f);
  if (soNumero) return { tipo: 'numero', n: soNumero };

  if (/^(rolar|role|descer|desce|rolar para baixo|role para baixo|para baixo|pra baixo|mais)$/.test(f)) return { tipo: 'rolar', direcao: 'baixo' };
  if (/^(subir|sobe|rolar para cima|role para cima|para cima|pra cima)$/.test(f)) return { tipo: 'rolar', direcao: 'cima' };
  if (/^(topo|ir para o topo|inicio da pagina|voltar ao topo)$/.test(f)) return { tipo: 'rolar', direcao: 'topo' };
  if (/^(fim|final|fim da pagina|ir para o fim|rodape)$/.test(f)) return { tipo: 'rolar', direcao: 'fim' };

  if (/^(proximo campo|campo seguinte|pular campo)$/.test(f)) return { tipo: 'campo', direcao: 'proximo' };
  if (/^(campo anterior)$/.test(f)) return { tipo: 'campo', direcao: 'anterior' };
  if (/^(apagar|limpar) (o )?campo$/.test(f)) return { tipo: 'apagarCampo' };
  if ((m = frase.trim().match(/^(escrever|escreva|digitar|digite)\s+(.+)$/i))) return { tipo: 'escrever', texto: m[2]!.trim() };

  if (/^(letra|letras|texto) (maior|maiores)$|^aumentar (a )?(letra|texto|fonte)$/.test(f)) return { tipo: 'preferencia', acao: 'letraMaior' };
  if (/^(letra|letras|texto) (menor|menores)$|^diminuir (a )?(letra|texto|fonte)$/.test(f)) return { tipo: 'preferencia', acao: 'letraMenor' };
  if (/^(alto )?contraste$/.test(f)) return { tipo: 'preferencia', acao: 'contraste' };
  if (/^(modo|tema) (escuro|noturno|de noite)$/.test(f)) return { tipo: 'preferencia', acao: 'escuro' };
  if (/^(modo|tema) (claro|branco|de dia)$/.test(f)) return { tipo: 'preferencia', acao: 'claro' };

  if (/^(voltar|volta|retornar)$/.test(f)) return { tipo: 'voltar' };
  if (/^(continuar|continua|proximo|avancar|seguir)$/.test(f)) return { tipo: 'clicar', alvo: 'continuar' };
  if (/^(enviar|envia|mandar|confirmar)$/.test(f)) return { tipo: 'clicar', alvo: f === 'confirmar' ? 'confirmar' : 'enviar' };

  if ((m = f.match(/^(ir para|ir pra|ir pro|ir ao|ir a|vai para|va para|abrir|abra|abre|mostrar) (.+)$/))) {
    const d = destinoDe(m[2]!);
    if (d) return { tipo: 'ir', destino: d };
    return { tipo: 'clicar', alvo: m[2]! };
  }
  if ((m = f.match(/^(clicar|clique|clica|apertar|aperte|tocar|toque|selecionar|selecione|escolher|escolha|marcar|marque|desmarcar|desmarque)( em| no| na| o| a)? (.+)$/))) {
    return { tipo: 'clicar', alvo: m[3]! };
  }
  const d = destinoDe(f);
  if (d) return { tipo: 'ir', destino: d };
  return { tipo: 'desconhecido', frase };
}

/** Pontuacao e edicao faladas durante o ditado (aceita com ou sem acento) */
const PONTUACAO: Array<[RegExp, string]> = [
  [/\s*(?:^|\s)ponto de interroga[cç][aã]o(?=\s|$)/gi, '?'],
  [/\s*(?:^|\s)ponto de exclama[cç][aã]o(?=\s|$)/gi, '!'],
  [/\s*(?:^|\s)ponto e v[ií]rgula(?=\s|$)/gi, ';'],
  [/\s*(?:^|\s)ponto final(?=\s|$)/gi, '.'],
  [/\s*(?:^|\s)v[ií]rgula(?=\s|$)/gi, ','],
  [/\s*(?:^|\s)dois pontos(?=\s|$)/gi, ':'],
  [/\s*(?:^|\s)(?:nova linha|pr[oó]xima linha|par[aá]grafo)(?=\s|$)\s*/gi, '\n'],
];

/**
 * Junta o que a pessoa falou ao texto que ja estava no campo.
 * "apagar ultima palavra" e "apagar tudo" editam em vez de escrever.
 */
export function aplicarDitado(atual: string, falado: string): string {
  const n = normalizar(falado);
  if (/^apagar (tudo|todo o texto)$/.test(n)) return '';
  if (/^apagar (a )?ultima palavra$/.test(n)) return atual.replace(/\s*\S+\s*$/, '');
  let texto = falado.trim();
  for (const [r, troca] of PONTUACAO) texto = texto.replace(r, troca);
  texto = texto.replace(/([.,!?:;])(?=[^\s.,!?:;])/g, '$1 ').replace(/[ \t]+$/, '');
  if (!texto) return atual;
  const inicioDeFrase = !atual.trim() || /[.!?\n]\s*$/.test(atual);
  if (inicioDeFrase) texto = texto.charAt(0).toUpperCase() + texto.slice(1);
  texto = texto.replace(/([.!?\n]\s*)(\p{Ll})/gu, (_m, antes: string, letra: string) => antes + letra.toUpperCase());
  if (/^[.,!?:;\n]/.test(texto)) return atual.replace(/[ \t]+$/, '') + texto;
  const sep = !atual || /\s$/.test(atual) ? '' : ' ';
  return atual + sep + texto;
}

/** Lista mostrada na ajuda dos comandos de voz */
export const AJUDA_COMANDOS: Array<[string, string]> = [
  ['“ir para registrar”, “acompanhar”, “transparência”, “início”', 'Abre a página'],
  ['“mostrar números” e depois “número 3”', 'Numera tudo que dá para clicar; fale o número'],
  ['“clicar em enviar”, “escolher iluminação”', 'Clica no botão, link ou opção com esse nome'],
  ['“continuar”, “voltar”, “enviar”', 'Avança ou volta nos passos do formulário'],
  ['“escrever …”, “próximo campo”, “apagar campo”', 'Preenche o campo selecionado'],
  ['“descer”, “subir”, “topo”, “fim”', 'Rola a página'],
  ['“ler a página”, “parar”', 'Lê em voz alta ou para a leitura'],
  ['“letra maior”, “contraste”, “modo escuro”', 'Ajusta a tela'],
  ['“ajuda”, “desligar comandos”', 'Mostra esta lista ou para de ouvir'],
];
