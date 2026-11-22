export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo: string = 'erro',
  ) {
    super(message);
  }
}
export const naoEncontrado = (msg = 'Não encontrado') => new ErroHttp(404, msg, 'nao_encontrado');
export const proibido = (msg = 'Você não tem permissão para esta ação') => new ErroHttp(403, msg, 'proibido');
export const invalido = (msg: string) => new ErroHttp(400, msg, 'invalido');
export const conflito = (msg: string) => new ErroHttp(409, msg, 'conflito');
export const naoAutenticado = () => new ErroHttp(401, 'Entre com sua conta para continuar', 'nao_autenticado');
