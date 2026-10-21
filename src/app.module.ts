import { Module } from "@nestjs/common";
import { extname, join } from "node:path";
import { ResourceModule } from "./resource/resource.module";
import { dataSource } from "./database/data-source";

@Module({
  imports: [
    ResourceModule.forRoot({
      resourcesPath: join(__dirname, "../resources"),
      extension: extname(__filename) as ".ts" | ".js",
      dataSource,
    }),
  ],
})
export class AppModule {}
