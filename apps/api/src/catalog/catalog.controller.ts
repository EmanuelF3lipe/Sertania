/**
 * Catalogo de servicos (especificacao secao 5 e 8).
 *
 * A interface precisa deste endpoint antes de mostrar a tela de abertura, e o
 * motivo esta em um dado que ela nao pode inventar: qual politica de prazo se
 * aplica ao servico escolhido. O prazo congelado no pedido vem da versao do
 * servico, e nao de um valor que o navegador decide.
 *
 * Duas coisas deliberadas neste arquivo:
 *
 * 1. O catalogo e' montado em UMA consulta, com `json_agg` aninhado. Nao por
 *    desempenho: por clareza. A tela pede tres secretarias; tres consultas
 *    seguidas dariam o mesmo resultado com mais codigo e mais um lugar para a
 *    ordem das linhas sair errada.
 *
 * 2. `publishedCommitment` vai para a resposta. A secao 8 diz que em ambiente
 *    demonstrativo pode existir prazo SIMULADO, e que so prazo validado e
 *    publicado apresenta compromisso de atendimento. Sem esse sinal na tela, um
 *    prazo inventado aparece com a mesma aparencia de um prazo oficial.
 */
import { Controller, Get, HttpCode } from '@nestjs/common';
import { Database } from '../database/typed-query';
import { CurrentSession } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';

/** Prazo que se aplica ao servico, como a interface precisa exibi-lo. */
export interface CatalogoPrazo {
  readonly id: string;
  readonly firstResponseMinutes: number;
  readonly resolutionValue: number;
  readonly resolutionUnit: string;
  /** `false` quando o prazo e' SIMULADO e nao constitui compromisso municipal. */
  readonly publishedCommitment: boolean;
}

export interface CatalogoServico {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly guidance: string;
  /** Unidade responsavel padrao. A tela ainda permite escolher outra. */
  readonly defaultUnitId: string;
  readonly requiresRepresentation: boolean;
  readonly maxAttachments: number;
  /** Campos extras do formulario, vindos do catalogo, nao do codigo da tela. */
  readonly formSchema: unknown;
  readonly sla: CatalogoPrazo;
}

export interface CatalogoSecretariat {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly services: readonly CatalogoServico[];
}

@Controller('api/v1')
export class CatalogController {
  constructor(private readonly db: Database) {}

  /**
   * Catalogo agrupado por secretaria.
   *
   * Exige sessao pelo guarda global, e nao por decisao desta classe. Um
   * catalogo publico de unidades, classificacoes e prazos nao e' o que a
   * especificacao pede: o cidadao escolhe dentro do que a prefeitura publica,
   * e a lista completa de unidades internas nao precisa estar a disposicao de
   * quem ainda nao entrou.
   */
  @Get('catalog')
  @HttpCode(200)
  async catalog(@CurrentSession() session: SessionClaims | undefined): Promise<{
    secretariats: readonly CatalogoSecretariat[];
  }> {
    // A sessao nao e' usada no corpo, e ainda assim e' parametro: e' o que
    // documenta a exigencia de sessao no proprio metodo, e nao so no guarda.
    void session;

    // O alias da coluna e' `secretaria`, e o tipo declarado aqui precisa casar
    // com ele. A alternativa seria apelidar a coluna em ingles e o dominio em
    // portugues no mesmo arquivo, e o custo de traduzir mentalmente apareceria
    // em toda leitura futura.
    const linhas = await this.db.run<{ secretaria: CatalogoSecretariat }>(CATALOGO_SQL);

    // Catalogo vazio e' estado de implantacao, nao erro. A interface mostra
    // "nenhum servico disponivel" e nao um 500: as duas coisas pedem respostas
    // diferentes de quem opera e de quem usa.
    return { secretariats: linhas.map((linha) => linha.secretaria) };
  }
}

/**
 * Consulta do catalogo.
 *
 * Servico inativo e versao nao publicada nao chegam ao navegador, e o filtro
 * esta no SQL. Um filtro equivalente em JavaScript, depois da consulta,
 * funcionaria tambem: por isso a escolha importa. A condicao de negocio do que
 * pode ser oferecido fica a dois passos do dado, e nao em outro arquivo.
 */
const CATALOGO_SQL = `
  SELECT json_build_object(
    'id',      s."id",
    'slug',    s."slug",
    'name',    s."name",
    'description', COALESCE(s."description", ''),
    'services', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id',                    sv."id",
          'slug',                  s2."slug",
          'name',                  sv."name",
          'description',           sv."description",
          'guidance',              sv."guidance",
          'formSchema',            sv."form_schema",
          'defaultUnitId',         COALESCE(s2."default_unit_id", u."id"),
          'requiresRepresentation', sv."requires_representation",
          'maxAttachments',        sv."max_attachments",
          'sla', json_build_object(
            'id',                   sp."id",
            'firstResponseMinutes', sp."first_response_minutes",
            'resolutionValue',      sp."resolution_value",
            'resolutionUnit',       sp."resolution_unit"::text,
            'publishedCommitment',  sp."is_published_commitment"
          )
        )
        ORDER BY s2."slug", sv."version" DESC
      )
      FROM "service_versions" sv
      JOIN "services" s2 ON s2."id" = sv."service_id"
      JOIN "sla_policies" sp ON sp."id" = sv."sla_policy_id"
      LEFT JOIN "units" u ON u."id" = s2."default_unit_id"
      WHERE s2."secretariat_id" = s."id"
        AND s2."active" = true
        AND sv."published" = true
    ), '[]'::json)
  ) AS "secretaria"
  FROM "secretariats" s
  WHERE s."active" = true
  ORDER BY s."name"
`;
