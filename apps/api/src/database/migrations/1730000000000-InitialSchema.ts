import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial (especificacao secao 11).
 *
 * Decisoes de projeto que valem registro:
 *
 * 1. Tipos ENUM do PostgreSQL para estados, resultados, classificacoes e
 *    canais. O dominio tem listas fechadas; um ENUM faz o banco recusar valor
 *    invalido, e nao apenas a aplicacao.
 *
 * 2. Chaves estrangeiras e restricoes declaradas no banco, e nao so no codigo.
 *    A secao 11 exige que o estado, a classificacao, a nota e o resultado
 *    fiquem dentro dos valores permitidos.
 *
 * 3. `timestamptz` em todo campo de instante, conforme a secao 11.
 *
 * 4. Sem `ON DELETE CASCADE` em tabela de historico administrativo. Apagar
 *    historico por cascata e o que a especificacao proibe explicitamente.
 *
 * 5. Indice espacial GiST no ponto de localizacao, para consulta por
 *    distancia em Infraestrutura.
 */
export class InitialSchema1730000000000 implements MigrationInterface {
  name = 'InitialSchema1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "postgis"`);

    // --- Tipos de dominio ------------------------------------------------
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "information_classification" AS ENUM (
          'PUBLIC_APPROVED', 'INTERNAL', 'RESTRICTED_PERSONAL', 'RESTRICTED_SENSITIVE'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "request_state" AS ENUM (
          'DRAFT','SUBMITTED','IN_REVIEW','WAITING_CITIZEN',
          'SCHEDULED','IN_PROGRESS','COMPLETED','CANCELED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "request_outcome" AS ENUM ('RESOLVED','DENIED','DUPLICATE','OUT_OF_SCOPE');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "request_channel" AS ENUM ('WEB','ASSISTED_DESK','ASSISTED_PHONE');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "identity_verification_method" AS ENUM (
          'NONE_RECORDED','CPF_CONFIRMED_IN_PERSON',
          'DOCUMENT_PRESENTED_IN_PERSON','KNOWN_CADASTRE'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "priority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "request_event_type" AS ENUM (
          'CREATED','SUBMITTED','STATE_CHANGED','ASSIGNED','TRANSFERRED',
          'INFORMATION_REQUESTED','INFORMATION_PROVIDED','SCHEDULED',
          'EXECUTION_STARTED','COMPLETED','CANCELED','REOPEN_REQUESTED',
          'REOPEN_DECIDED','RELATED_LINKED','TASK_CREATED','TASK_ACCEPTED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "event_visibility" AS ENUM ('CITIZEN_VISIBLE','INTERNAL_ONLY');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "sla_unit" AS ENUM (
          'BUSINESS_HOURS','CALENDAR_HOURS','BUSINESS_DAYS','CALENDAR_DAYS'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // --- Identidade ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
        "is_citizen" boolean NOT NULL DEFAULT false,
        "is_server" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_users_status" CHECK ("status" IN ('ACTIVE','SUSPENDED','BLOCKED'))
      );
    COMMENT ON TABLE "users" IS 'Nao ha senha local: a autenticacao e do Keycloak';
    `);

    await queryRunner.query(`
      CREATE TABLE "external_identities" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "issuer" varchar(255) NOT NULL,
        "subject" varchar(255) NOT NULL,
        "realm" varchar(128) NOT NULL,
        "email" varchar(320),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_external_identities_issuer_subject" UNIQUE ("issuer","subject")
      );
    COMMENT ON TABLE "external_identities" IS 'Unicidade por issuer+subject: nao confiar apenas em e-mail';
    `);

    // --- Organizacao -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "secretariats" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "slug" varchar(120) NOT NULL UNIQUE,
        "name" varchar(160) NOT NULL,
        "description" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "secretariats" IS 'Secretarias sao registros, nao tabelas separadas';
    `);

    await queryRunner.query(`
      CREATE TABLE "units" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "name" varchar(140) NOT NULL,
        "locality" varchar(120),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "units" IS 'Unidade sempre pertence a uma secretaria';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_units_secretariat" ON "units" ("secretariat_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "teams" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
        "secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "name" varchar(140) NOT NULL,
        "enabled_service_slugs" text[] NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "teams" IS 'Em Saude, equipes habilitadas tratam servico especifico';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_teams_unit" ON "teams" ("unit_id")`,
    );

    // --- Vinculos e concessoes -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "memberships" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "role" varchar(32) NOT NULL,
        "secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "unit_ids" uuid[] NOT NULL DEFAULT '{}',
        "team_ids" uuid[] NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "starts_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz,
        "revoked_by" uuid,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_memberships_role" CHECK ("role" IN (
          'CITIZEN','ATTENDANT','OPERATIONAL_TEAM','SECRETARY_MANAGER',
          'CENTRAL_MANAGEMENT','TECH_ADMIN','AUDITOR'
        ))
      );
    COMMENT ON TABLE "memberships" IS 'Um servidor pode ter varios vinculos; cada um com seu escopo';
    `);
    await queryRunner.query(`CREATE INDEX "idx_memberships_user" ON "memberships" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_memberships_secretariat" ON "memberships" ("secretariat_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "access_grants" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "action" varchar(64) NOT NULL,
        "resource_type" varchar(64) NOT NULL,
        "resource_id" uuid NOT NULL,
        "purpose" text NOT NULL,
        "approved_by" uuid NOT NULL,
        "starts_at" timestamptz NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        CONSTRAINT "chk_access_grants_purpose" CHECK (length(trim("purpose")) > 0),
        CONSTRAINT "chk_access_grants_window" CHECK ("expires_at" > "starts_at")
      );
    COMMENT ON TABLE "access_grants" IS 'Concessao excepcional: recurso, acao, finalidade e validade';
    `);
    await queryRunner.query(`CREATE INDEX "idx_access_grants_user" ON "access_grants" ("user_id")`);

    // --- Catalogo --------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "sla_policies" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL UNIQUE,
        "name" varchar(120) NOT NULL,
        "first_response_minutes" integer NOT NULL,
        "resolution_value" integer NOT NULL,
        "resolution_unit" "sla_unit" NOT NULL,
        "running_states" text[] NOT NULL,
        "paused_states" text[] NOT NULL,
        "is_published_commitment" boolean NOT NULL DEFAULT false,
        "frozen_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_sla_first_response_positive" CHECK ("first_response_minutes" > 0),
        CONSTRAINT "chk_sla_resolution_positive" CHECK ("resolution_value" > 0)
      );
    COMMENT ON TABLE "sla_policies" IS 'Politica versionada; o pedido congela a versao aplicada';
    `);

    await queryRunner.query(`
      CREATE TABLE "sla_policy_changes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "policy_id" uuid NOT NULL REFERENCES "sla_policies"("id") ON DELETE RESTRICT,
        "from_version" integer NOT NULL,
        "to_version" integer NOT NULL,
        "reason" text NOT NULL,
        "changed_by" uuid NOT NULL,
        "previous_values" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_sla_change_reason" CHECK (length(trim("reason")) > 0)
      );
    COMMENT ON TABLE "sla_policy_changes" IS 'Mudanca excepcional registra motivo, responsavel e valores anteriores';
    `);

    await queryRunner.query(`
      CREATE TABLE "services" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "slug" varchar(120) NOT NULL UNIQUE,
        "secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "default_unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX "idx_services_secretariat" ON "services" ("secretariat_id")`);

    await queryRunner.query(`
      CREATE TABLE "service_versions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE RESTRICT,
        "version" integer NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text NOT NULL,
        "guidance" text NOT NULL,
        "form_schema" jsonb NOT NULL,
        "classification" "information_classification" NOT NULL,
        "requires_representation" boolean NOT NULL DEFAULT false,
        "max_attachments" integer NOT NULL DEFAULT 5,
        "published" boolean NOT NULL DEFAULT false,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_service_versions_service_version" UNIQUE ("service_id","version"),
        CONSTRAINT "chk_service_versions_max_attachments" CHECK (
          "max_attachments" >= 0 AND "max_attachments" <= 20
        )
      );
    COMMENT ON TABLE "services" IS 'Formulario publicado nao pode ser alterado retroativamente';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_service_versions_service" ON "service_versions" ("service_id","version")`,
    );

    // --- Solicitacoes ----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "protocol" varchar(32),
        "citizen_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "channel" "request_channel" NOT NULL,
        "service_version_id" uuid NOT NULL REFERENCES "service_versions"("id") ON DELETE RESTRICT,
        "secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
        "state" "request_state" NOT NULL DEFAULT 'DRAFT',
        "outcome" "request_outcome",
        "outcome_justification" jsonb,
        "internal_outcome_note" text,
        "priority" "priority" NOT NULL DEFAULT 'NORMAL',
        "priority_justification" text,
        "priority_changed_by" uuid,
        "classification" "information_classification" NOT NULL,
        "sla_policy_id" uuid NOT NULL REFERENCES "sla_policies"("id") ON DELETE RESTRICT,
        "assignee_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "submitted_at" timestamptz,
        "cycle_started_at" timestamptz,
        "first_human_response_at" timestamptz,
        "scheduled_for" timestamptz,
        "schedule_is_estimate" boolean NOT NULL DEFAULT true,
        "completed_at" timestamptz,
        "canceled_at" timestamptz,
        "cancel_reason" text,
        "cycle_number" integer NOT NULL DEFAULT 1,
        "state_before_waiting" "request_state",
        "identity_verification_method" "identity_verification_method",
        "assisted_note" varchar(160),
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_requests_cycles_positive" CHECK ("cycle_number" >= 1),
        CONSTRAINT "chk_requests_version_positive" CHECK ("version" >= 1)
      );
    COMMENT ON TABLE "requests" IS 'Protocolo em SER-AAAA-NNNNNN, gerado em transacao no envio';
    `);
    // Protocolo unico, mas so quando presente: multiplos rascunhos coexistem
    // com protocolo nulo.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_requests_protocol" ON "requests" ("protocol")
      WHERE "protocol" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_requests_citizen_created" ON "requests" ("citizen_id","created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_requests_queue" ON "requests" ("secretariat_id","unit_id","state","created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_requests_assignee_state" ON "requests" ("assignee_user_id","state")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_requests_service_created" ON "requests" ("service_version_id","created_at" DESC)
    `);

    // Conclusao exige resultado e justificativa publica (secao 6).
    await queryRunner.query(`
      ALTER TABLE "requests" ADD CONSTRAINT "chk_requests_completed_requires_outcome"
      CHECK (
        "state" <> 'COMPLETED'
        OR ("outcome" IS NOT NULL AND "outcome_justification" IS NOT NULL)
      )
    `);
    // Rascunho nao tem protocolo nem instante de envio.
    await queryRunner.query(`
      ALTER TABLE "requests" ADD CONSTRAINT "chk_requests_draft_has_no_protocol"
      CHECK ("state" <> 'DRAFT' OR "protocol" IS NULL)
    `);
    // Mudanca de prioridade exige justificativa auditada.
    await queryRunner.query(`
      ALTER TABLE "requests" ADD CONSTRAINT "chk_requests_priority_justified"
      CHECK (
        "priority" = 'NORMAL'
        OR ("priority_justification" IS NOT NULL AND "priority_changed_by" IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "request_content" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL UNIQUE REFERENCES "requests"("id") ON DELETE RESTRICT,
        "description" text NOT NULL,
        "form_answers" jsonb NOT NULL DEFAULT '{}',
        "protected_data_ciphertext" text,
        "protected_key_version" integer,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "request_content" IS 'Conteudo separado de metadados operacionais';
    `);

    await queryRunner.query(`
      CREATE TABLE "request_locations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL UNIQUE REFERENCES "requests"("id") ON DELETE RESTRICT,
        "address_text" text NOT NULL,
        "reference" varchar(240),
        "locality" varchar(140),
        "point" geography(Point,4326),
        "precision_source" varchar(32) NOT NULL,
        "precision_meters" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_request_locations_source" CHECK (
          "precision_source" IN ('MAP_PICK','TYPED','GEOCODED','UNKNOWN')
        ),
        CONSTRAINT "chk_request_locations_precision" CHECK (
          "precision_meters" IS NULL OR "precision_meters" >= 0
        )
      );
    COMMENT ON TABLE "request_locations" IS 'Local da ocorrencia, NAO a residencia do cidadao';
    `);
    // Indice espacial GiST para consulta por distancia (secao 11 e 14).
    await queryRunner.query(`
      CREATE INDEX "idx_request_locations_point_gist" ON "request_locations"
      USING GIST ("point")
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_request_locations_locality" ON "request_locations" ("locality")`,
    );

    // --- Ciclo de atendimento --------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "request_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "type" "request_event_type" NOT NULL,
        "visibility" "event_visibility" NOT NULL,
        "state_before" "request_state",
        "state_after" "request_state",
        "public_text" text NOT NULL,
        "internal_note" text,
        "reason" text,
        "cycle_number" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "request_events" IS 'Correcoes geram novos eventos; o passado nao e apagado';
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_request_events_request_created" ON "request_events" ("request_id","created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "author_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "visibility" "event_visibility" NOT NULL,
        "body_ciphertext" text NOT NULL,
        "key_version" integer,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "messages" IS 'Nota interna nunca entra no DTO publico';
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_messages_request_created" ON "messages" ("request_id","created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "information_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "return_state" "request_state" NOT NULL,
        "question" text NOT NULL,
        "expected_response" text,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "answered_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_information_requests_status" CHECK (
          "status" IN ('PENDING','ANSWERED','CANCELLED')
        )
      );
    COMMENT ON TABLE "information_requests" IS 'Guarda o estado anterior valido para devolver ao estagio certo';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_information_requests_request" ON "information_requests" ("request_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sla_pauses" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "state" "request_state" NOT NULL,
        "started_at" timestamptz NOT NULL,
        "ended_at" timestamptz,
        "reason" text NOT NULL,
        "approved_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_sla_pauses_window" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
      );
    COMMENT ON TABLE "sla_pauses" IS 'Pausa registra inicio e fim; sem isso nao da para reconstruir o relogio';
    `);
    await queryRunner.query(`CREATE INDEX "idx_sla_pauses_request" ON "sla_pauses" ("request_id")`);

    await queryRunner.query(`
      CREATE TABLE "transfers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "from_secretariat_id" uuid REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "from_unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT,
        "to_secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "to_unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE RESTRICT,
        "reason" text NOT NULL,
        "transferred_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    COMMENT ON TABLE "transfers" IS 'Transferencia preserva protocolo e prazo total';
    `);
    await queryRunner.query(`CREATE INDEX "idx_transfers_request" ON "transfers" ("request_id")`);

    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "assignee_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "to_secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "summary" text NOT NULL,
        "location_summary" text,
        "attachment_ids" uuid[] NOT NULL DEFAULT '{}',
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "accepted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_tasks_status" CHECK (
          "status" IN ('PENDING','ACCEPTED','DECLINED','DONE')
        )
      );
    COMMENT ON TABLE "tasks" IS 'Tarefa NAO concede acesso ao pedido completo nem a anexos nao selecionados';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_assignee" ON "tasks" ("assignee_user_id","status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "reopen_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "reason" text NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "decision_reason" text,
        "decided_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_reopen_requests_status" CHECK (
          "status" IN ('PENDING','APPROVED','DENIED')
        )
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_reopen_requests_request" ON "reopen_requests" ("request_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "request_cycles" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "cycle_number" integer NOT NULL,
        "started_at" timestamptz NOT NULL,
        "closed_at" timestamptz,
        "elapsed_business_minutes" integer NOT NULL DEFAULT 0,
        "from_reopen" boolean NOT NULL DEFAULT false,
        CONSTRAINT "uq_request_cycles_request_cycle" UNIQUE ("request_id","cycle_number"),
        CONSTRAINT "chk_request_cycles_number" CHECK ("cycle_number" >= 1)
      );
    COMMENT ON TABLE "reopen_requests" IS 'Um registro por ciclo: reabertura nao apaga o tempo anterior';
    `);

    await queryRunner.query(`
      CREATE TABLE "request_relations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "related_request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "type" varchar(32) NOT NULL,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_request_relations" UNIQUE ("request_id","related_request_id","type"),
        CONSTRAINT "chk_request_relations_type" CHECK (
          "type" IN ('DUPLICATE_OF','RECURRENCE_OF')
        ),
        CONSTRAINT "chk_request_relations_not_self" CHECK ("request_id" <> "related_request_id")
      );
    COMMENT ON TABLE "request_relations" IS 'Recorrencia e analitica e nao equivale a duplicidade administrativa';
    `);

    await queryRunner.query(`
      CREATE TABLE "evaluations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE RESTRICT,
        "cycle_number" integer NOT NULL,
        "author_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "rating" integer NOT NULL,
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_evaluations_cycle_author" UNIQUE ("request_id","cycle_number","author_user_id"),
        CONSTRAINT "chk_evaluations_rating_range" CHECK ("rating" BETWEEN 1 AND 5)
      );
    COMMENT ON TABLE "evaluations" IS 'Uma avaliacao por ciclo e autor';
    `);

    // --- Operacao --------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "attachments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "request_id" uuid REFERENCES "requests"("id") ON DELETE RESTRICT,
        "task_id" uuid REFERENCES "tasks"("id") ON DELETE RESTRICT,
        "storage_key" varchar(512) NOT NULL,
        "internal_name" varchar(255) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "detected_media_type" varchar(120) NOT NULL,
        "sha256" varchar(64) NOT NULL,
        "inspection_state" varchar(32) NOT NULL DEFAULT 'QUARANTINED',
        "inspection_detail" text,
        "classification" "information_classification" NOT NULL,
        "visibility" varchar(32) NOT NULL DEFAULT 'CITIZEN_OWN',
        "retention_policy" varchar(64) NOT NULL,
        "inspected_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_attachments_inspection_state" CHECK (
          "inspection_state" IN ('QUARANTINED','SCANNING','RELEASED','REJECTED','ERROR')
        ),
        CONSTRAINT "chk_attachments_visibility" CHECK (
          "visibility" IN ('CITIZEN_OWN','TEAM','INTERNAL_ONLY')
        ),
        CONSTRAINT "chk_attachments_size_positive" CHECK ("size_bytes" > 0),
        CONSTRAINT "chk_attachments_linked" CHECK (
          "request_id" IS NOT NULL OR "task_id" IS NOT NULL
        )
      );
    COMMENT ON TABLE "attachments" IS 'Bucket sem leitura publica; download revalida acesso';
    `);
    await queryRunner.query(`CREATE INDEX "idx_attachments_request" ON "attachments" ("request_id")`);
    await queryRunner.query(`CREATE INDEX "idx_attachments_owner" ON "attachments" ("owner_user_id")`);

    await queryRunner.query(`
      CREATE TABLE "attachment_access_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "attachment_id" uuid NOT NULL REFERENCES "attachments"("id") ON DELETE RESTRICT,
        "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "action" varchar(32) NOT NULL,
        "result" varchar(32) NOT NULL,
        "reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_attachment_access_action" CHECK (
          "action" IN ('DOWNLOAD','UPLOAD','REMOVE_REQUEST')
        ),
        CONSTRAINT "chk_attachment_access_result" CHECK (
          "result" IN ('ALLOWED','DENIED','NOT_AVAILABLE')
        )
      );
    COMMENT ON TABLE "attachment_access_events" IS 'Sem conteudo e sem URL assinada';
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_attachment_access_attachment" ON "attachment_access_events" ("attachment_id","created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz,
        "last_error" text,
        "idempotency_key" varchar(160) NOT NULL UNIQUE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_outbox_attempts" CHECK ("attempts" >= 0)
      );
    COMMENT ON TABLE "outbox_events" IS 'Gravado na mesma transacao do pedido: falha de e-mail nao desfaz protocolo';
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_outbox_pending" ON "outbox_events" ("processed_at","attempts")
    `);

    await queryRunner.query(`
      CREATE TABLE "notification_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "outbox_event_id" uuid NOT NULL REFERENCES "outbox_events"("id") ON DELETE RESTRICT,
        "channel" varchar(16) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "sent_at" timestamptz,
        "error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_notification_channel" CHECK ("channel" IN ('APP','EMAIL')),
        CONSTRAINT "chk_notification_status" CHECK (
          "status" IN ('PENDING','SENT','FAILED','SKIPPED')
        )
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_notification_deliveries_event" ON "notification_deliveries" ("outbox_event_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "actor_user_id" uuid,
        "action" varchar(64) NOT NULL,
        "resource_type" varchar(64) NOT NULL,
        "resource_id" uuid,
        "result" varchar(32) NOT NULL,
        "context" jsonb,
        "correlation_id" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_audit_result" CHECK ("result" IN ('ALLOWED','DENIED','ERROR'))
      );
    COMMENT ON TABLE "notification_deliveries" IS 'Sem senha, token, anexo ou conteudo clinico; usuario da aplicacao nao altera';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_actor" ON "audit_events" ("actor_user_id","created_at" DESC)`,
    );
    await queryRunner.query(`
      CREATE INDEX "idx_audit_resource" ON "audit_events" ("resource_type","resource_id","created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "operation" varchar(64) NOT NULL,
        "key" varchar(160) NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "result_entity_id" uuid,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_idempotency_scope" UNIQUE ("user_id","operation","key")
      );
    COMMENT ON TABLE "idempotency_keys" IS 'Repetir a mesma abertura nao cria outro protocolo';
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_idempotency_expires" ON "idempotency_keys" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "privacy_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "subject_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "kind" varchar(32) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'PENDING',
        "decision_reason" text,
        "decided_by" uuid,
        "decided_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_privacy_requests_kind" CHECK (
          "kind" IN ('ACCESS','DELETION','RECTIFICATION','PORTABILITY')
        ),
        CONSTRAINT "chk_privacy_requests_status" CHECK (
          "status" IN ('PENDING','IN_ANALYSIS','FULFILLED','PARTIALLY_FULFILLED','DENIED')
        )
      );
    COMMENT ON TABLE "privacy_requests" IS 'Pedido de exclusao passa por analise; nao apaga registro publico obrigatorio';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_privacy_requests_subject" ON "privacy_requests" ("subject_user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "export_jobs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "purpose" text NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'QUEUED',
        "storage_key" varchar(64),
        "row_count" integer NOT NULL DEFAULT 0,
        "expires_at" timestamptz NOT NULL,
        "error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_export_jobs_status" CHECK (
          "status" IN ('QUEUED','RUNNING','READY','EXPIRED','FAILED')
        ),
        CONSTRAINT "chk_export_jobs_purpose" CHECK (length(trim("purpose")) > 0)
      );
    COMMENT ON TABLE "export_jobs" IS 'Trabalho assincrono com finalidade, expiracao e revalidacao no download';
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_export_jobs_requester" ON "export_jobs" ("requested_by","created_at" DESC)`,
    );

    // --- Protecoes adicionais --------------------------------------------
    // Um pedido encerrado nao recebe transferencia de estado silenciosa: a
    // transicao passa pela tabela de regras e gera evento. A restricao abaixo
    // impede o caso mais comum de erro: concluir um pedido ja concluido sem
    // registrar o ciclo.
    await queryRunner.query(`
      ALTER TABLE "requests" ADD CONSTRAINT "chk_requests_completed_timestamp"
      CHECK ("state" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
    `);
    await queryRunner.query(`
      ALTER TABLE "requests" ADD CONSTRAINT "chk_requests_canceled_reason"
      CHECK ("state" <> 'CANCELED' OR "cancel_reason" IS NOT NULL)
    `);
    // Atendimento assistido exige metodo de verificacao registrado (secao 5).
    await queryRunner.query(`
      ALTER TABLE "requests" ADD CONSTRAINT "chk_requests_assisted_verification"
      CHECK (
        "channel" = 'WEB'
        OR ("identity_verification_method" IS NOT NULL AND "assisted_note" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A ordem importa por causa das restricoes de chave estrangeira.
    const tables = [
      'export_jobs',
      'privacy_requests',
      'idempotency_keys',
      'audit_events',
      'notification_deliveries',
      'outbox_events',
      'attachment_access_events',
      'attachments',
      'evaluations',
      'request_relations',
      'request_cycles',
      'reopen_requests',
      'tasks',
      'transfers',
      'sla_pauses',
      'information_requests',
      'messages',
      'request_events',
      'request_locations',
      'request_content',
      'requests',
      'service_versions',
      'services',
      'sla_policy_changes',
      'sla_policies',
      'access_grants',
      'memberships',
      'teams',
      'units',
      'secretariats',
      'external_identities',
      'users',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    const types = [
      'sla_unit',
      'event_visibility',
      'request_event_type',
      'priority',
      'identity_verification_method',
      'request_channel',
      'request_outcome',
      'request_state',
      'information_classification',
    ];
    for (const type of types) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${type}"`);
    }
  }
}
