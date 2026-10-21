import "reflect-metadata";
import { DataSource } from "typeorm";
import { config } from "../config";
import { resources } from "../../resources";
import { createEntity } from "../resource/resource.registry";
import { AttachmentEntity } from "../storage/attachment.entity";
import { join } from "node:path";
export const dataSource = new DataSource({
  type: config.DB_TYPE,
  host: config.DB_HOST,
  port: config.DB_PORT ?? (config.DB_TYPE === "mysql" ? 3306 : 5432),
  username: config.DB_USERNAME,
  password: config.DB_PASSWORD,
  database: config.DB_DATABASE,
  synchronize: config.DB_SYNCHRONIZE,
  entities: [...resources.map(createEntity), AttachmentEntity],
  migrations: [join(__dirname, "migrations/*{.ts,.js}")],
  ...(config.DB_TYPE === "mysql" ? { charset: "utf8mb4" } : {}),
});
