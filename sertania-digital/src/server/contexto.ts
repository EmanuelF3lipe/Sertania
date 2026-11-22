import type { Request } from 'express';
import { z } from 'zod';
import type { Banco } from './db.js';
import type { Config } from './config.js';
import type { Ator } from './auditoria.js';
import { invalido } from './erros.js';

export interface Ctx {
  banco: Banco;
  config: Config;
}

export function ator(req: Request): Ator {
  return req.usuario ? { id: req.usuario.id, nome: req.usuario.nome, ip: req.ip } : { id: null, nome: 'Cidadão (sem conta)', ip: req.ip };
}

/** Valida a entrada com zod e devolve mensagem amigavel. */
export function validar<T extends z.ZodTypeAny>(esquema: T, dados: unknown): z.infer<T> {
  const r = esquema.safeParse(dados);
  if (!r.success) {
    const p = r.error.issues[0];
    throw invalido(p ? `${p.path.join('.') || 'dados'}: ${p.message}` : 'Dados inválidos');
  }
  return r.data;
}

export const idParam = (req: Request): number => {
  const n = Number(req.params['id']);
  if (!Number.isInteger(n) || n <= 0) throw invalido('Identificador inválido');
  return n;
};

export const textoOpc = z
  .string()
  .max(4000)
  .optional()
  .nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));
