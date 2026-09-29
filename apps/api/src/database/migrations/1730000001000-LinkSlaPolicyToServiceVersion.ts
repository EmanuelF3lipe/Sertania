import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vincula a versao de servico a politica de prazo (secao 8).
 *
 * Por que esta migration existe: a especificacao diz que "cada versao de servico
 * referencia uma politica com prazo de primeira resposta humana, prazo de
 * conclusao, calendario, unidade de contagem e regra de pausa". O esquema
 * inicial nao tinha essa coluna, e sem ela a interface nao tem como saber qual
 * prazo exibir ao cidadao, nem qual politica congelar no pedido.
 *
 * A coluna entra NULLABLE, e so vira NOT NULL no fim. Transformar em NOT NULL
 * e' uma operacao que reescreve a tabela e falha se houver linha sem valor.
 * Fazer em duas etapas, com o preenchimento no meio, e' o que permite rodar em
 * um banco que ja tenha dados.
 *
 * Decisao de project: `ON DELETE RESTRICT`, e nao CASCADE. Uma politica de prazo
 * congelada num pedido nao pode sumir porque alguem editou o catalogo. A
 * especificacao proibe cascata em historico administrativo, e um prazo congelado
 * e' historico.
 */
export class LinkSlaPolicyToServiceVersion1730000001000 implements MigrationInterface {
  name = 'LinkSlaPolicyToServiceVersion1730000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_versions" ADD COLUMN "sla_policy_id" uuid`,
    );

    // Preenchimento: a versao mais recente que a prefeitura marked como
    // compromisso publicado. `is_published_commitment` distingue prazo validado
    // de prazo SIMULADO, conforme a secao 8: em ambiente demonstrativo pode
    // existir prazo simulado, e a interface precisa saber qual e'.
    //
    // Uma versao sem politica e' deixada para NULL em vez de receber uma politica
    // arbitraria: e' melhor um dado faltando, que o `NOT NULL` abaixo recusa com
    // mensagem clara, do que um prazo inventado exibido ao cidadao.
    await queryRunner.query(`
      UPDATE "service_versions" sv
         SET "sla_policy_id" = (
           SELECT sp."id"
             FROM "sla_policies" sp
            WHERE sp."is_published_commitment" = true
            ORDER BY sp."version" DESC
            LIMIT 1
         )
       WHERE sv."sla_policy_id" IS NULL
    `);

    // `queryRunner.query` devolve `any` no TypeORM. A anotacao abaixo e' o que
    // mantem a regra `no-unsafe-assignment`: sem ela a linha seguinte vira
    // acesso a `any`, e o compilador para de conferir o que a migration le.
    const pendentes = (await queryRunner.query(
      `SELECT count(*)::int AS total FROM "service_versions" WHERE "sla_policy_id" IS NULL`,
    )) as Array<{ total: number }>;
    const total = pendentes[0]?.total ?? 0;
    if (total > 0) {
      // Mensagem explicita, e nao um erro generico de constraint: quem estiver
      // olhando o log precisa saber que o problema e' "nao existe politica
      // publicada", e nao "a migration falhou".
      throw new Error(
        `Nao foi possivel tornar "sla_policy_id" obrigatorio: ${total} versao(oes) de ` +
          'servico seguem sem politica de prazo, e nao existe politica publicada para ' +
          'associar. Publique uma politica em `sla_policies` antes de rodar esta migration.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "service_versions" ALTER COLUMN "sla_policy_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_versions"
        ADD CONSTRAINT "service_versions_sla_policy_id_fkey"
        FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE RESTRICT
    `);

    // Consulta do catalogo e por secretaria, e depois pelas versoes do servico.
    // Sem indice, ela varre a tabela inteira a cada tela de abertura.
    await queryRunner.query(`
      CREATE INDEX "service_versions_sla_policy_id_idx" ON "service_versions" ("sla_policy_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "service_versions_sla_policy_id_idx"`);
    await queryRunner.query(
      `ALTER TABLE "service_versions" DROP CONSTRAINT IF EXISTS "service_versions_sla_policy_id_fkey"`,
    );
    // A coluna precisa voltar a ser anulavel antes de ser removida: remover
    // direto funciona, mas deixar o schema no estado anterior do jeito que ele
    // estava e' o que permite um `down` realmente reversivel.
    await queryRunner.query(
      `ALTER TABLE "service_versions" ALTER COLUMN "sla_policy_id" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "service_versions" DROP COLUMN "sla_policy_id"`);
  }
}
