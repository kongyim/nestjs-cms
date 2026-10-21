import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { dataSource } from "../database/data-source";
import { ResourceController } from "./resource.controller";
import { ResourceRegistry } from "./resource.registry";
import { ResourceService } from "./resource.service";
import { AttachmentService } from "../storage/attachment.service";
import { S3Service } from "../storage/s3.service";
@Module({
  controllers: [ResourceController],
  providers: [
    {
      provide: DataSource,
      useFactory: () =>
        dataSource.isInitialized ? dataSource : dataSource.initialize(),
    },
    ResourceRegistry,
    ResourceService,
    AttachmentService,
    S3Service,
  ],
  exports: [ResourceService, ResourceRegistry, AttachmentService, DataSource],
})
export class ResourceModule {
  async onModuleDestroy() {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
