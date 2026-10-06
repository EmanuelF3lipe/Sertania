import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { InformationClassification, SlaUnit } from '@sertania/contracts';
import { AuthorizationService } from '../authorization/authorization.service';
import { Database, Transaction } from '../database/typed-query';
import type { SessionClaims } from '../auth/session.service';

const CLASSIFICATIONS = new Set<InformationClassification>([
  'PUBLIC_APPROVED',
  'INTERNAL',
  'RESTRICTED_PERSONAL',
  'RESTRICTED_SENSITIVE',
]);
const SLA_UNITS = new Set<SlaUnit>([
  'BUSINESS_HOURS',
  'CALENDAR_HOURS',
  'BUSINESS_DAYS',
  'CALENDAR_DAYS',
]);

export interface CatalogServicePayload {
  readonly slug?: string;
  readonly name?: string;
  readonly description?: string;
  readonly guidance?: string;
  readonly secretariatId?: string;
  readonly unitId?: string;
  readonly teamName?: string;
  readonly classification?: string;
  readonly requiresRepresentation?: boolean;
  readonly maxAttachments?: number;
  readonly firstResponseMinutes?: number;
  readonly resolutionValue?: number;
  readonly resolutionUnit?: string;
  readonly published?: boolean;
  readonly active?: boolean;
  readonly formSchema?: unknown;
}

export interface CatalogUnitPayload {
  readonly secretariatId?: string;
  readonly name?: string;
  readonly locality?: string;
}

interface SecretariatRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

interface UnitRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly secretariat_id: string;
  readonly name: string;
  readonly locality: string | null;
  readonly active: boolean;
}

interface ServiceRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly slug: string;
  readonly secretariat_id: string;
  readonly default_unit_id: string | null;
  readonly active: boolean;
  readonly version_id: string | null;
  readonly version: number | null;
  readonly service_name: string | null;
  readonly description: string | null;
  readonly guidance: string | null;
  readonly form_schema: unknown;
  readonly classification: InformationClassification | null;
  readonly requires_representation: boolean | null;
  readonly max_attachments: number | null;
  readonly published: boolean | null;
  readonly published_at: Date | string | null;
  readonly sla_id: string | null;
  readonly sla_name: string | null;
  readonly first_response_minutes: number | null;
  readonly resolution_value: number | null;
  readonly resolution_unit: SlaUnit | null;
  readonly is_published_commitment: boolean | null;
}

interface TeamRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly secretariat_id: string;
  readonly unit_id: string;
  readonly name: string;
  readonly enabled_service_slugs: string[];
  readonly active: boolean;
}

function text(value: string | undefined, field: string, max: number): string {
  const result = value?.trim() ?? '';
  if (result === '' || result.length > max) {
    throw new BadRequestException(`${field} e obrigatorio e deve ter no maximo ${max} caracteres.`);
  }
  return result;
}

function slug(value: string | undefined): string {
  const result = value?.trim().toLowerCase() ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result) || result.length > 120) {
    throw new BadRequestException('O identificador deve usar apenas letras minusculas, numeros e hifens.');
  }
  return result;
}

function uuid(value: string | undefined, field: string): string {
  const result = text(value, field, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new BadRequestException(`${field} invalida.`);
  }
  return result;
}

function positiveInteger(value: number | undefined, field: string, max: number): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > max) {
    throw new BadRequestException(`${field} deve ser um numero inteiro positivo.`);
  }
  return value as number;
}

function nonNegativeInteger(value: number | undefined, field: string, max: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new BadRequestException(`${field} deve ser um numero inteiro entre zero e ${max}.`);
  }
  return value as number;
}

function booleanValue(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
  ) {}

  async read(session: SessionClaims | undefined) {
    const subject = await this.managerSubject(session);
    const secretariatIds = [...new Set(
      subject.memberships
        .filter((membership) => membership.role === 'SECRETARY_MANAGER')
        .map((membership) => membership.secretariatId),
    )];
    if (secretariatIds.length === 0) throw new ForbiddenException();

    const [secretariats, units, services, teams] = await Promise.all([
      this.db.run<SecretariatRow>(
        `SELECT "id","slug","name","description","active"
           FROM "secretariats"
          WHERE "id" = ANY($1::uuid[])
          ORDER BY "name"`,
        [secretariatIds],
      ),
      this.db.run<UnitRow>(
        `SELECT "id","secretariat_id","name","locality","active"
           FROM "units"
          WHERE "secretariat_id" = ANY($1::uuid[])
          ORDER BY "name"`,
        [secretariatIds],
      ),
      this.db.run<ServiceRow>(
        `SELECT s."id",s."slug",s."secretariat_id",s."default_unit_id",s."active",
                sv."id" AS "version_id",sv."version",sv."name" AS "service_name",
                sv."description",sv."guidance",sv."form_schema",sv."classification",
                sv."requires_representation",sv."max_attachments",sv."published",sv."published_at",
                sp."id" AS "sla_id",sp."name" AS "sla_name",sp."first_response_minutes",
                sp."resolution_value",sp."resolution_unit",sp."is_published_commitment"
           FROM "services" s
           LEFT JOIN LATERAL (
             SELECT * FROM "service_versions" candidate
              WHERE candidate."service_id" = s."id"
              ORDER BY candidate."version" DESC
              LIMIT 1
           ) sv ON true
           LEFT JOIN "sla_policies" sp ON sp."id" = sv."sla_policy_id"
          WHERE s."secretariat_id" = ANY($1::uuid[])
          ORDER BY s."slug"`,
        [secretariatIds],
      ),
      this.db.run<TeamRow>(
        `SELECT "id","secretariat_id","unit_id","name","enabled_service_slugs","active"
           FROM "teams"
          WHERE "secretariat_id" = ANY($1::uuid[])
          ORDER BY "name"`,
        [secretariatIds],
      ),
    ]);

    return {
      secretariats: secretariats.map((secretariat) => ({
        id: secretariat.id,
        slug: secretariat.slug,
        name: secretariat.name,
        description: secretariat.description ?? '',
        active: secretariat.active,
        units: units
          .filter((unit) => unit.secretariat_id === secretariat.id)
          .map((unit) => ({
            id: unit.id,
            name: unit.name,
            locality: unit.locality ?? '',
            active: unit.active,
          })),
        services: services
          .filter((service) => service.secretariat_id === secretariat.id)
          .map((service) => ({
            id: service.id,
            slug: service.slug,
            active: service.active,
            defaultUnitId: service.default_unit_id,
            version: service.version === null ? null : {
              id: service.version_id,
              number: service.version,
              name: service.service_name ?? '',
              description: service.description ?? '',
              guidance: service.guidance ?? '',
              formSchema: service.form_schema ?? { fields: [] },
              classification: service.classification ?? 'INTERNAL',
              requiresRepresentation: service.requires_representation ?? false,
              maxAttachments: service.max_attachments ?? 0,
              published: service.published ?? false,
              publishedAt: service.published_at,
              sla: service.sla_id === null ? null : {
                id: service.sla_id,
                name: service.sla_name ?? '',
                firstResponseMinutes: service.first_response_minutes ?? 0,
                resolutionValue: service.resolution_value ?? 0,
                resolutionUnit: service.resolution_unit ?? 'BUSINESS_DAYS',
                publishedCommitment: service.is_published_commitment ?? false,
              },
            },
            teams: teams
              .filter((team) => team.secretariat_id === secretariat.id && team.active)
              .map((team) => ({
                id: team.id,
                unitId: team.unit_id,
                name: team.name,
                enabled: team.enabled_service_slugs.includes(service.slug),
              })),
          })),
      })),
    };
  }

  async createUnit(session: SessionClaims | undefined, input: CatalogUnitPayload) {
    const secretariatId = uuid(input.secretariatId, 'A secretaria');
    await this.requireManagerFor(session, secretariatId);
    const name = text(input.name, 'O nome da unidade', 140);
    const locality = input.locality?.trim() || null;
    const existing = await this.db.run(
      `SELECT "id" FROM "units" WHERE "secretariat_id" = $1 AND lower("name") = lower($2)`,
      [secretariatId, name],
    );
    if (existing.length > 0) throw new BadRequestException('Ja existe uma unidade com esse nome.');
    const rows = await this.db.run<{ id: string }>(
      `INSERT INTO "units" ("secretariat_id","name","locality") VALUES ($1,$2,$3) RETURNING "id"`,
      [secretariatId, name, locality],
    );
    return { id: rows[0]?.id ?? '', name, locality: locality ?? '' };
  }

  async createService(session: SessionClaims | undefined, input: CatalogServicePayload) {
    const data = this.normalize(input);
    await this.requireManagerFor(session, data.secretariatId);
    await this.requireUnit(data.secretariatId, data.unitId);
    const duplicate = await this.db.run(
      `SELECT "id" FROM "services" WHERE "slug" = $1`,
      [data.slug],
    );
    if (duplicate.length > 0) throw new BadRequestException('Ja existe um servico com esse identificador.');

    const serviceId = await this.db.transaction(async (tx) => {
      const service = await tx.run<{ id: string }>(
        `INSERT INTO "services" ("slug","secretariat_id","default_unit_id","active")
         VALUES ($1,$2,$3,$4) RETURNING "id"`,
        [data.slug, data.secretariatId, data.unitId, data.active],
      );
      const createdServiceId = service[0]?.id;
      if (createdServiceId === undefined) throw new Error('Servico nao criado.');
      const policyId = await this.insertPolicy(tx, data);
      await tx.run(
        `INSERT INTO "service_versions"
          ("service_id","version","name","description","guidance","form_schema",
           "classification","requires_representation","max_attachments","published","published_at","sla_policy_id")
         VALUES ($1,1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
        [
          createdServiceId,
          data.name,
          data.description,
          data.guidance,
          JSON.stringify(data.formSchema),
          data.classification,
          data.requiresRepresentation,
          data.maxAttachments,
          data.published,
          data.published ? new Date() : null,
          policyId,
        ],
      );
      await this.upsertTeam(tx, data);
      return createdServiceId;
    });
    await this.audit(session, 'CATALOG_SERVICE_CREATED', serviceId);
    return { serviceId };
  }

  async updateService(session: SessionClaims | undefined, serviceId: string, input: CatalogServicePayload) {
    uuid(serviceId, 'O servico');
    const existing = await this.db.run<{
      secretariat_id: string;
      default_unit_id: string | null;
      version: number;
      slug: string;
    }>(
      `SELECT s."secretariat_id",s."default_unit_id",s."slug",COALESCE(MAX(sv."version"),0)::int AS "version"
         FROM "services" s LEFT JOIN "service_versions" sv ON sv."service_id" = s."id"
        WHERE s."id" = $1 GROUP BY s."id",s."secretariat_id",s."default_unit_id",s."slug"`,
      [serviceId],
    );
    const current = existing[0];
    if (current === undefined) throw new NotFoundException('Servico nao encontrado.');
    const data = this.normalize(input, current.secretariat_id);
    await this.requireManagerFor(session, data.secretariatId);
    await this.requireUnit(data.secretariatId, data.unitId);
    const duplicate = await this.db.run(
      `SELECT "id" FROM "services" WHERE "slug" = $1 AND "id" <> $2`,
      [data.slug, serviceId],
    );
    if (duplicate.length > 0) throw new BadRequestException('Ja existe outro servico com esse identificador.');

    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE "services" SET "slug"=$2,"default_unit_id"=$3,"active"=$4 WHERE "id"=$1`,
        [serviceId, data.slug, data.unitId, data.active],
      );
      const policyId = await this.insertPolicy(tx, data);
      if (data.published) {
        await tx.run(
          `UPDATE "service_versions" SET "published" = false WHERE "service_id" = $1 AND "published" = true`,
          [serviceId],
        );
      }
      await tx.run(
        `INSERT INTO "service_versions"
          ("service_id","version","name","description","guidance","form_schema",
           "classification","requires_representation","max_attachments","published","published_at","sla_policy_id")
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
        [
          serviceId,
          current.version + 1,
          data.name,
          data.description,
          data.guidance,
          JSON.stringify(data.formSchema),
          data.classification,
          data.requiresRepresentation,
          data.maxAttachments,
          data.published,
          data.published ? new Date() : null,
          policyId,
        ],
      );
      if (current.version > 0) {
        const previousPolicy = await tx.run<{ id: string; version: number; name: string; first_response_minutes: number; resolution_value: number; resolution_unit: SlaUnit }>(
          `SELECT sp."id",sp."version",sp."name",sp."first_response_minutes",sp."resolution_value",sp."resolution_unit"
             FROM "service_versions" sv JOIN "sla_policies" sp ON sp."id" = sv."sla_policy_id"
            WHERE sv."service_id" = $1 AND sv."version" = $2`,
          [serviceId, current.version],
        );
        const previous = previousPolicy[0];
        if (previous !== undefined) {
          const nextPolicy = await tx.run<{ version: number }>(`SELECT "version" FROM "sla_policies" WHERE "id" = $1`, [policyId]);
          await tx.run(
            `INSERT INTO "sla_policy_changes"
              ("policy_id","from_version","to_version","reason","changed_by","previous_values")
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [
              policyId,
              previous.version,
              nextPolicy[0]?.version ?? previous.version + 1,
              'Atualizacao do catalogo pela gestao municipal.',
              session?.userId,
              JSON.stringify(previous),
            ],
          );
        }
      }
      await this.upsertTeam(tx, data, current.slug);
    });
    await this.audit(session, 'CATALOG_SERVICE_UPDATED', serviceId);
    return { serviceId, version: current.version + 1 };
  }

  private normalize(input: CatalogServicePayload, fallbackSecretariatId?: string) {
    const secretariatId = uuid(input.secretariatId ?? fallbackSecretariatId, 'A secretaria');
    const unitId = uuid(input.unitId, 'A unidade');
    const name = text(input.name, 'O nome do servico', 160);
    const description = text(input.description, 'A descricao', 2000);
    const guidance = text(input.guidance, 'A orientacao', 3000);
    const serviceSlug = slug(input.slug);
    const classification = input.classification as InformationClassification | undefined;
    if (classification === undefined || !CLASSIFICATIONS.has(classification)) {
      throw new BadRequestException('Classificacao de informacao invalida.');
    }
    const resolutionUnit = input.resolutionUnit as SlaUnit | undefined;
    if (resolutionUnit === undefined || !SLA_UNITS.has(resolutionUnit)) {
      throw new BadRequestException('Unidade do prazo invalida.');
    }
    const formSchema = input.formSchema !== null && typeof input.formSchema === 'object'
      ? input.formSchema
      : { fields: [] };
    return {
      secretariatId,
      unitId,
      slug: serviceSlug,
      name,
      description,
      guidance,
      teamName: text(input.teamName ?? 'Atendimento municipal', 'O nome da equipe', 140),
      classification,
      requiresRepresentation: booleanValue(input.requiresRepresentation, false),
      maxAttachments: nonNegativeInteger(input.maxAttachments ?? 0, 'O limite de anexos', 20),
      firstResponseMinutes: positiveInteger(input.firstResponseMinutes, 'O prazo de primeira resposta', 1_000_000),
      resolutionValue: positiveInteger(input.resolutionValue, 'O prazo de conclusao', 10_000),
      resolutionUnit,
      published: booleanValue(input.published, false),
      active: booleanValue(input.active, true),
      formSchema,
    };
  }

  private async insertPolicy(tx: Transaction, data: ReturnType<CatalogAdminService['normalize']>): Promise<string> {
    const maxRows = await tx.run<{ max: number }>(`SELECT COALESCE(MAX("version"),0)::int AS "max" FROM "sla_policies"`);
    const version = Number(maxRows[0]?.max ?? 0) + 1;
    const rows = await tx.run<{ id: string }>(
      `INSERT INTO "sla_policies"
        ("version","name","first_response_minutes","resolution_value","resolution_unit",
         "running_states","paused_states","is_published_commitment")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "id"`,
      [
        version,
        `${data.name} - prazo v${version}`,
        data.firstResponseMinutes,
        data.resolutionValue,
        data.resolutionUnit,
        ['SUBMITTED', 'IN_REVIEW', 'SCHEDULED', 'IN_PROGRESS'],
        ['WAITING_CITIZEN'],
        data.published,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Politica de prazo nao criada.');
    return id;
  }

  private async upsertTeam(
    tx: Transaction,
    data: ReturnType<CatalogAdminService['normalize']>,
    previousSlug?: string,
  ): Promise<void> {
    const current = await tx.run<{ id: string; enabled_service_slugs: string[] }>(
      `SELECT "id","enabled_service_slugs" FROM "teams"
        WHERE "secretariat_id" = $1 AND "unit_id" = $2 AND "name" = $3 LIMIT 1`,
      [data.secretariatId, data.unitId, data.teamName],
    );
    if (current[0] !== undefined) {
      await tx.run(
        `UPDATE "teams"
            SET "active" = true,
                "enabled_service_slugs" = CASE
                  WHEN $2::text = ANY("enabled_service_slugs")
                    THEN ARRAY(
                      SELECT DISTINCT CASE WHEN value = $2::text THEN $3::text ELSE value END
                        FROM unnest("enabled_service_slugs") AS value
                    )
                  WHEN $3::text = ANY("enabled_service_slugs") THEN "enabled_service_slugs"
                  ELSE array_append("enabled_service_slugs", $3::text)
                END
          WHERE "id" = $1`,
        [current[0].id, previousSlug ?? data.slug, data.slug],
      );
      return;
    }
    if (previousSlug !== undefined) {
      await tx.run(
        `UPDATE "teams"
            SET "enabled_service_slugs" = ARRAY(
              SELECT DISTINCT CASE WHEN value = $2::text THEN $3::text ELSE value END
                FROM unnest("enabled_service_slugs") AS value
            )
          WHERE "secretariat_id" = $1 AND $2::text = ANY("enabled_service_slugs")`,
        [data.secretariatId, previousSlug, data.slug],
      );
    }
    await tx.run(
      `INSERT INTO "teams" ("unit_id","secretariat_id","name","enabled_service_slugs") VALUES ($1,$2,$3,$4)`,
      [data.unitId, data.secretariatId, data.teamName, [data.slug]],
    );
  }

  private async requireUnit(secretariatId: string, unitId: string): Promise<void> {
    const rows = await this.db.run(
      `SELECT "id" FROM "units" WHERE "id"=$1 AND "secretariat_id"=$2 AND "active"=true`,
      [unitId, secretariatId],
    );
    if (rows.length === 0) throw new BadRequestException('A unidade nao pertence a secretaria selecionada.');
  }

  private async managerSubject(session: SessionClaims | undefined) {
    if (session === undefined || !session.isServer) throw new ForbiddenException();
    const subject = await this.authorization.subjectFor(session, new Date());
    if (!subject.memberships.some((membership) => membership.role === 'SECRETARY_MANAGER')) {
      throw new ForbiddenException();
    }
    return subject;
  }

  private async requireManagerFor(session: SessionClaims | undefined, secretariatId: string): Promise<void> {
    const subject = await this.managerSubject(session);
    const allowed = subject.memberships.some(
      (membership) => membership.role === 'SECRETARY_MANAGER' && membership.secretariatId === secretariatId,
    );
    if (!allowed) throw new ForbiddenException();
  }

  private async audit(session: SessionClaims | undefined, action: string, resourceId: string): Promise<void> {
    if (session === undefined) return;
    await this.authorization.audit({
      actorUserId: session.userId,
      action,
      resourceType: 'service',
      resourceId,
      result: 'ALLOWED',
      reason: 'CATALOG_MANAGE',
      correlationId: `catalog-${resourceId}`,
    });
  }
}
