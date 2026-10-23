import {
  BadRequestException,
  CanActivate,
  Controller,
  DynamicModule,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpCode,
  Injectable,
  Module,
  ModuleMetadata,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "@nestjs-cms/auth";
import { ResourceRegistry } from "@nestjs-cms/core";
import { DataSource } from "typeorm";
import { DatabaseImporter } from "./importer";
import { ImportOptions } from "./options";

@Injectable()
export class ImportGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (
      request.headers["x-cms-request"] !== "1" ||
      (request.headers.origin &&
        request.headers.origin !== this.auth.options.adminOrigin)
    )
      throw new ForbiddenException("Invalid request origin.");
    const token = request.headers.cookie
      ?.split(";")
      .map((part: string) => part.trim())
      .find((part: string) => part.startsWith("cms_session="))
      ?.slice("cms_session=".length);
    const identity = await this.auth.authenticate(token);
    if (!identity.permissions.includes("users:manage"))
      throw new ForbiddenException();
    request.identity = identity;
    context.switchToHttp().getResponse().setHeader("Cache-Control", "no-store");
    return true;
  }
}

@Controller("api/database/import")
@UseGuards(ImportGuard)
export class ImportController {
  constructor(
    private readonly importer: DatabaseImporter,
    private readonly auth: AuthService,
  ) {}
  @Post()
  @HttpCode(200)
  async run(@Req() request: { identity: { permissions: string[] } }) {
    try {
      return await this.importer.run({
        canWrite: (resource) => {
          const required =
            this.auth.options.resourcePermissions[resource]?.write;
          return !!required && request.identity.permissions.includes(required);
        },
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        error instanceof Error ? error.message : "Database import failed.",
      );
    }
  }
}

@Module({})
export class CmsImportModule {
  /** Import the same configured CmsAuthModule used by the host, sharing its connection/registry. */
  static forRoot(
    options: ImportOptions & {
      imports: NonNullable<ModuleMetadata["imports"]>;
    },
  ): DynamicModule {
    return {
      module: CmsImportModule,
      imports: options.imports,
      controllers: [ImportController],
      providers: [
        ImportGuard,
        {
          provide: DatabaseImporter,
          inject: [DataSource, ResourceRegistry],
          useFactory: (db: DataSource, registry: ResourceRegistry) =>
            new DatabaseImporter(db, registry, options),
        },
      ],
      exports: [DatabaseImporter],
    };
  }
}
