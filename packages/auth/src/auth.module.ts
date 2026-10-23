import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  ResourceModule,
  createCmsDataSource,
  loadResources,
} from "@nestjs-cms/core";
import type { DataSourceOptions, EntitySchema } from "typeorm";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { Credential, Session } from "./auth.entities";
import users from "./resources/users";
import { createRolesResource } from "./resources/roles";
import { AUTH_OPTIONS, CmsAuthOptions, resolveOptions } from "./options";

/** Also used by a host's TypeORM migration entry point. Does not connect to the database. */
export function createAuthDataSource(
  options: CmsAuthOptions,
  database: Pick<DataSourceOptions, "migrations"> = {},
) {
  const applicationResources = [
    ...(options.resourcesPath
      ? loadResources(options.resourcesPath, options.extension ?? ".js")
      : []),
    ...(options.resources ?? []),
  ];
  const resolved = resolveOptions(options, applicationResources);
  const resources = [
    ...applicationResources,
    createRolesResource(resolved.permissions),
    users,
  ];
  const dataSource = createCmsDataSource(resources, database);
  dataSource.setOptions({
    entities: [
      ...(dataSource.options.entities as EntitySchema[]),
      Credential,
      Session,
    ],
  });
  return { dataSource, resources, options: resolved };
}

@Module({})
export class CmsAuthModule {
  static forRoot(options: CmsAuthOptions): DynamicModule {
    const prepared = createAuthDataSource(options);
    return {
      module: CmsAuthModule,
      imports: [
        ResourceModule.forRoot({
          resources: prepared.resources,
          dataSource: prepared.dataSource,
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AUTH_OPTIONS, useValue: prepared.options },
        AuthService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [ResourceModule, AuthService],
    };
  }
}
