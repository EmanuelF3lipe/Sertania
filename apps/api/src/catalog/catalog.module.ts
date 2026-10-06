/**
 * Modulo do catalogo (especificacao secao 5).
 *
 * `Database` vem do modulo global de infraestrutura. Declara-lo aqui criaria
 * uma segunda instancia, com um segundo pool de conexoes.
 */
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogAdminService } from './catalog-admin.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogAdminService],
})
export class CatalogModule {}
