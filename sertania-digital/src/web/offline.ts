/**
 * Fila offline: solicitacoes feitas sem sinal ficam no aparelho (IndexedDB) e
 * sao enviadas quando a conexao volta. Cada uma tem chave de idempotencia, entao
 * reenviar nao cria duplicata no servidor.
 */
import { enviarFormulario } from './api';

interface Pendente {
  chave: string;
  dados: Record<string, unknown>;
  arquivos: Array<{ nome: string; tipo: string; blob: Blob }>;
  criadoEm: string;
}
export interface Enviada { chave: string; protocolo: string; codigo: string; enviadoEm: string }

const BANCO = 'sertania-offline';

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('pendentes', { keyPath: 'chave' });
      r.result.createObjectStore('enviadas', { keyPath: 'chave' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

async function op<T>(loja: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const t = db.transaction(loja, modo);
    const req = fn(t.objectStore(loja));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

export async function guardar(dados: Record<string, unknown>, arquivos: File[]): Promise<void> {
  const p: Pendente = {
    chave: String(dados['chaveIdempotencia']),
    dados,
    arquivos: arquivos.map((a) => ({ nome: a.name, tipo: a.type, blob: a })),
    criadoEm: new Date().toISOString(),
  };
  await op('pendentes', 'readwrite', (s) => s.put(p));
}

export const pendentes = () => op<Pendente[]>('pendentes', 'readonly', (s) => s.getAll());
export const enviadas = () => op<Enviada[]>('enviadas', 'readonly', (s) => s.getAll());

let sincronizando = false;
export async function sincronizar(): Promise<Enviada[]> {
  if (sincronizando || !navigator.onLine) return [];
  sincronizando = true;
  const feitas: Enviada[] = [];
  try {
    for (const p of await pendentes()) {
      try {
        const arquivos = p.arquivos.map((a) => new File([a.blob], a.nome, { type: a.tipo }));
        const r = await enviarFormulario<{ protocolo: string; codigo: string }>('/publico/demandas', p.dados, arquivos);
        const e: Enviada = { chave: p.chave, protocolo: r.protocolo, codigo: r.codigo, enviadoEm: new Date().toISOString() };
        await op('enviadas', 'readwrite', (s) => s.put(e));
        await op('pendentes', 'readwrite', (s) => s.delete(p.chave));
        feitas.push(e);
      } catch (erro) {
        if ((erro as { status?: number }).status === 0) break; // continua sem rede
        console.warn('Falha ao sincronizar', erro);
      }
    }
  } finally {
    sincronizando = false;
  }
  return feitas;
}
