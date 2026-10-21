import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { config } from "../config";
import { ResourceDefinition } from "../resource/resource.types";
import { createEntity } from "../resource/resource.registry";
import { AttachmentEntity } from "../storage/attachment.entity";

export function createCmsDataSource(
  resources: ResourceDefinition[],
  options: Pick<DataSourceOptions, "migrations"> = {},
): DataSource {
  return new DataSource({
    type: config.DB_TYPE,
    host: config.DB_HOST,
    port: config.DB_PORT ?? (config.DB_TYPE === "mysql" ? 3306 : 5432),
    username: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    database: config.DB_DATABASE,
    synchronize: config.DB_SYNCHRONIZE,
    entities: [...resources.map(createEntity), AttachmentEntity],
    migrations: options.migrations ?? [],
    ...(config.DB_TYPE === "mysql" ? { charset: "utf8mb4" } : {}),
  });
}
