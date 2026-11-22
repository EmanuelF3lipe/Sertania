/** Documentacao OpenAPI 3.1 da API (padrao aberto para integracao futura). */
const op = (tag: string, summary: string, extra: Record<string, unknown> = {}) => ({ tags: [tag], summary, responses: { '200': { description: 'OK' } }, ...extra });
const corpo = (props: Record<string, unknown>, required: string[] = []) => ({
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: props, required } } } },
});

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Sertânia Digital – API',
    version: '1.0.0',
    description:
      'API da plataforma de demandas municipais de Sertânia/PE. Sessão por cookie HttpOnly + cabeçalho X-CSRF para mutações autenticadas. Integrações externas usam token Bearer com escopos (demandas:ler, demandas:criar, indicadores:ler) e nunca recebem dados pessoais.',
    license: { name: 'Dados abertos: CC-BY 4.0' },
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      sessao: { type: 'apiKey', in: 'cookie', name: 'sertania_sessao' },
      integracao: { type: 'http', scheme: 'bearer' },
    },
    schemas: {
      NovaDemanda: {
        type: 'object',
        required: ['servicoId', 'descricao'],
        properties: {
          servicoId: { type: 'integer' }, descricao: { type: 'string', minLength: 10 }, localidadeId: { type: 'integer' },
          lat: { type: 'number' }, lng: { type: 'number' }, endereco: { type: 'string' }, referencia: { type: 'string' },
          canal: { type: 'string', enum: ['APP', 'PRESENCIAL', 'TELEFONE', 'WHATSAPP', 'OUVIDORIA'] },
          anonima: { type: 'boolean' }, nome: { type: 'string' }, telefone: { type: 'string' }, email: { type: 'string' },
          chaveIdempotencia: { type: 'string', description: 'Repetir a mesma chave não cria duplicata (envio offline)' },
          consentimento: { type: 'boolean' },
        },
      },
    },
  },
  paths: {
    '/publico/catalogo': { get: op('Público', 'Secretarias, setores, serviços e localidades') },
    '/publico/sugerir-servico': { post: op('Público', 'Sugestão de serviço a partir do relato (IA local)', corpo({ texto: { type: 'string' } }, ['texto'])) },
    '/publico/demandas': { post: op('Público', 'Registrar solicitação (multipart: campo "dados" JSON + "arquivos")', { requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { dados: { type: 'string' }, arquivos: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } }, responses: { '201': { description: 'Protocolo e código de acesso' } } }) },
    '/publico/acompanhar': { post: op('Público', 'Acompanhar por protocolo + código', corpo({ protocolo: { type: 'string' }, codigo: { type: 'string' } }, ['protocolo', 'codigo'])) },
    '/publico/responder': { post: op('Público', 'Responder pedido de informação (multipart)') },
    '/publico/avaliar': { post: op('Público', 'Avaliar atendimento concluído (1 a 5)', corpo({ protocolo: { type: 'string' }, codigo: { type: 'string' }, nota: { type: 'integer' }, comentario: { type: 'string' } }, ['protocolo', 'codigo', 'nota'])) },
    '/publico/transparencia': { get: op('Público', 'Indicadores agregados dos últimos 90 dias') },
    '/publico/dados-abertos': { get: op('Público', 'Dados abertos agregados com supressão de grupos pequenos (?formato=csv)') },
    '/auth/cadastro': { post: op('Conta', 'Criar conta de cidadão') },
    '/auth/entrar': { post: op('Conta', 'Entrar', corpo({ email: { type: 'string' }, senha: { type: 'string' } }, ['email', 'senha'])) },
    '/auth/sair': { post: op('Conta', 'Sair') },
    '/auth/eu': { get: op('Conta', 'Sessão atual e token CSRF') },
    '/cidadao/demandas': { get: op('Cidadão', 'Minhas solicitações', { security: [{ sessao: [] }] }) },
    '/cidadao/meus-dados': { get: op('Cidadão', 'Exportar meus dados (LGPD art. 18)', { security: [{ sessao: [] }] }) },
    '/cidadao/excluir-conta': { post: op('Cidadão', 'Excluir conta e anonimizar solicitações', { security: [{ sessao: [] }] }) },
    '/gestao/demandas': { get: op('Gestão', 'Fila no escopo do perfil (filtros: de, ate, secretariaId, setorId, servicoId, localidadeId, status, canal, prioridade, busca, visao)', { security: [{ sessao: [] }] }), post: op('Gestão', 'Atendimento assistido (presencial, telefone, WhatsApp, ouvidoria)', { security: [{ sessao: [] }] }) },
    '/gestao/demandas/{id}': { get: op('Gestão', 'Detalhe com histórico, similares e sugestão de IA', { security: [{ sessao: [] }] }) },
    '/gestao/demandas/{id}/comandos/{comando}': { post: op('Gestão', 'Executar comando de fluxo: ENCAMINHAR, SOLICITAR_INFO, AGENDAR, INICIAR_EXECUCAO, REGISTRAR_IMPEDIMENTO, CONCLUIR, CANCELAR, REABRIR. Exige "versao" (concorrência otimista).', { security: [{ sessao: [] }] }) },
    '/gestao/demandas/{id}/atribuir': { post: op('Gestão', 'Definir responsável', { security: [{ sessao: [] }] }) },
    '/gestao/demandas/{id}/anotacoes': { post: op('Gestão', 'Registro de execução com evidências (multipart)', { security: [{ sessao: [] }] }) },
    '/gestao/demandas/{id}/analisar': { post: op('IA', 'Gerar sugestão de classificação, prioridade e resumo', { security: [{ sessao: [] }] }) },
    '/gestao/ia/sugestoes': { get: op('IA', 'Sugestões pendentes de decisão humana', { security: [{ sessao: [] }] }) },
    '/gestao/ia/sugestoes/{id}/decidir': { post: op('IA', 'Aceitar, ajustar ou rejeitar sugestão (auditado)', { security: [{ sessao: [] }] }) },
    '/gestao/ia/recorrencias': { get: op('IA', 'Grupos de demandas recorrentes', { security: [{ sessao: [] }] }) },
    '/gestao/alertas': { get: op('IA', 'Alertas (prazo, recorrência, pico por localidade)', { security: [{ sessao: [] }] }) },
    '/gestao/mapa': { get: op('Território', 'Pontos georreferenciados e focos de recorrência', { security: [{ sessao: [] }] }) },
    '/gestao/indicadores': { get: op('Indicadores', 'Indicadores por período, setor, serviço, situação e localidade', { security: [{ sessao: [] }] }) },
    '/gestao/exportar': { get: op('Indicadores', 'Exportar CSV/JSON sem dados pessoais (?formato=csv|json)', { security: [{ sessao: [] }] }) },
    '/gestao/relatorios': { get: op('Relatórios', 'Listar', { security: [{ sessao: [] }] }), post: op('Relatórios', 'Gerar relatório com narrativa (rascunho de IA para revisão)', { security: [{ sessao: [] }] }) },
    '/admin/usuarios': { get: op('Administração', 'Servidores e perfis', { security: [{ sessao: [] }] }), post: op('Administração', 'Criar servidor', { security: [{ sessao: [] }] }) },
    '/admin/catalogo': { get: op('Administração', 'Catálogo completo e feriados', { security: [{ sessao: [] }] }) },
    '/admin/diagnostico': { get: op('Administração', 'Linha de base do diagnóstico', { security: [{ sessao: [] }] }), post: op('Administração', 'Registrar dado de diagnóstico', { security: [{ sessao: [] }] }) },
    '/admin/auditoria': { get: op('Administração', 'Trilha de auditoria + verificação da cadeia de hash', { security: [{ sessao: [] }] }) },
    '/admin/backups': { get: op('Administração', 'Listar backups', { security: [{ sessao: [] }] }), post: op('Administração', 'Gerar backup consistente do banco', { security: [{ sessao: [] }] }) },
    '/admin/exportacao-completa': { get: op('Administração', 'Exportação integral em JSON aberto', { security: [{ sessao: [] }] }) },
    '/admin/tokens': { get: op('Administração', 'Tokens de integração', { security: [{ sessao: [] }] }), post: op('Administração', 'Criar token com escopos', { security: [{ sessao: [] }] }) },
    '/integracao/v1/demandas': { get: op('Integração', 'Demandas sem dados pessoais (escopo demandas:ler)', { security: [{ integracao: [] }] }), post: op('Integração', 'Registrar demanda vinda de outro sistema (escopo demandas:criar)', { security: [{ integracao: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NovaDemanda' } } } } }) },
    '/integracao/v1/indicadores': { get: op('Integração', 'Indicadores agregados (escopo indicadores:ler)', { security: [{ integracao: [] }] }) },
  },
};
