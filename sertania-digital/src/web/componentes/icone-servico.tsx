import {
  Bug, CloudRain, Construction, Droplets, HandHeart, Lightbulb, MessageSquareText, School, Stethoscope, Tractor, Trash, TreeDeciduous, type LucideIcon,
} from 'lucide-react';

/** Icone de traco por palavras do nome do servico: o catalogo e da prefeitura, entao nada e fixo por id. */
const ICONES: Array<[RegExp, LucideIcon]> = [
  [/l[âa]mpada|poste|ilumina/i, Lightbulb],
  [/bueiro|alaga|drenag|esgoto/i, CloudRain],
  [/buraco|cal[çc]amento|rua/i, Construction],
  [/lixo|coleta|entulho/i, Trash],
  [/[áa]rvore|poda/i, TreeDeciduous],
  [/dengue|mosquito|escorpi|pe[çc]onhento/i, Bug],
  [/sa[úu]de|ubs|posto/i, Stethoscope],
  [/escola|escolar/i, School],
  [/social|cras|visita/i, HandHeart],
  [/[áa]gua|pipa|cisterna|po[çc]o/i, Droplets],
  [/estrada|rural/i, Tractor],
];

export function IconeServico({ nome, tamanho = 22 }: { nome: string; tamanho?: number }) {
  const Icone = ICONES.find(([r]) => r.test(nome))?.[1] ?? MessageSquareText;
  return <Icone size={tamanho} strokeWidth={1.8} aria-hidden="true" />;
}
