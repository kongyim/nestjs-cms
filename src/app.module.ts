import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ResourceModule } from "./resource/resource.module";
import { ErrorFilter } from "./error.filter";
import { ApiKeyGuard } from "./api-key.guard";
@Module({
  imports: [ResourceModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
