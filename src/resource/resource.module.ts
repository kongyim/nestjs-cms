import { DynamicModule, Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createCmsDataSource } from "../database/create-data-source";
import { loadResources } from "./resource.loader";
import { ResourceController } from "./resource.controller";
import { ResourceRegistry } from "./resource.registry";
import { ResourceRecordStore } from "./resource-record.store";
import { ResourceService } from "./resource.service";
import { AttachmentService } from "../storage/attachment.service";
import { S3Service } from "../storage/s3.service";
import { ApiKeyGuard } from "../api-key.guard";
import { ErrorFilter } from "../error.filter";
import type { ResourceDefinition } from "./resource.types";

export interface ResourceModuleOptions {
  /** Absolute path to the consumer's resource directory. */
  resourcesPath?: string;
  /** Explicit definitions, combined with any discovered resources. */
  resources?: ResourceDefinition[];
  /** Use .ts only with a TypeScript runtime such as ts-node. Default: .js. */
  extension?: ".ts" | ".js";
  /** Optional dedicated CMS data source. This module closes it on shutdown. */
  dataSource?: DataSource;
}

@Module({})
export class ResourceModule {
  constructor(private readonly db: DataSource) {}

  static forRoot(options: ResourceModuleOptions): DynamicModule {
    // Scan once so the database and API use exactly the same definitions.
    const resources = [
      ...(options.resourcesPath
        ? loadResources(options.resourcesPath, options.extension ?? ".js")
        : []),
      ...(options.resources ?? []),
    ];
    const names = new Set<string>();
    for (const resource of resources) {
      if (names.has(resource.name))
        throw new Error(`Duplicate resource name: ${resource.name}`);
      names.add(resource.name);
    }
    const registry = new ResourceRegistry(resources);
    const source = options.dataSource ?? createCmsDataSource(resources);
    return {
      module: ResourceModule,
      controllers: [ResourceController],
      providers: [
        {
          provide: DataSource,
          useFactory: () =>
            source.isInitialized ? source : source.initialize(),
        },
        { provide: ResourceRegistry, useValue: registry },
        ResourceRecordStore,
        ResourceService,
        AttachmentService,
        S3Service,
        ApiKeyGuard,
        ErrorFilter,
      ],
      exports: [
        ResourceService,
        ResourceRegistry,
        AttachmentService,
        DataSource,
      ],
    };
  }

  async onModuleDestroy() {
    if (this.db.isInitialized) await this.db.destroy();
  }
}
