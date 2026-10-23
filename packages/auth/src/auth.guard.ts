import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService, cookieName, type Identity } from "./auth.service";

export type AuthRequest = Request & { identity: Identity };
export function sessionToken(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

@Injectable()
export class AuthGuard implements CanActivate {
  private attempts = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const resourceController = this.reflector.get<boolean>(
      "nestjs-cms:resource-controller",
      context.getClass(),
    );
    const authController = this.reflector.get<boolean>(
      "nestjs-cms:auth-controller",
      context.getClass(),
    );
    if (!resourceController && !authController) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const response = context
      .switchToHttp()
      .getResponse<{ setHeader: (name: string, value: string) => void }>();
    response.setHeader("Cache-Control", "no-store");
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (mutation) {
      const origin = request.headers.origin;
      if (
        request.headers["x-cms-request"] !== "1" ||
        (origin && origin !== this.auth.options.adminOrigin)
      ) {
        throw new ForbiddenException("Invalid request origin.");
      }
    }
    const publicAction = this.reflector.get<string>(
      "auth:public",
      context.getHandler(),
    );
    if (publicAction) {
      if (publicAction === "login") this.limitLogin(request.ip ?? "unknown");
      return true;
    }
    request.identity = await this.auth.authenticate(sessionToken(request));
    const required = this.reflector.get<string>(
      "auth:permission",
      context.getHandler(),
    );
    if (required && !request.identity.permissions.includes(required))
      throw new ForbiddenException();
    if (resourceController) {
      const resource = request.params.resource;
      const access =
        typeof resource === "string"
          ? this.auth.options.resourcePermissions[resource]
          : undefined;
      const permission =
        resource === undefined
          ? "users:manage"
          : access?.[mutation ? "write" : "read"];
      if (!permission) throw new ForbiddenException();
      if (!request.identity.permissions.includes(permission))
        throw new ForbiddenException();
      // The package's API key guard still runs after this session/permission guard.
      // Never send the shared key to the browser or accept it as a session bypass.
      if (process.env.ADMIN_API_KEY)
        request.headers["x-api-key"] = process.env.ADMIN_API_KEY;
    }
    return true;
  }

  private limitLogin(ip: string) {
    const now = Date.now();
    for (const [key, entry] of this.attempts)
      if (entry.reset <= now) this.attempts.delete(key);
    for (const [key, limit] of [
      ["global", 100],
      [`ip:${ip}`, 10],
    ] as const) {
      const entry = this.attempts.get(key) ?? { count: 0, reset: now + 60_000 };
      this.attempts.set(key, entry);
      if (++entry.count > limit)
        throw new HttpException(
          "Too many login attempts. Try again in a minute.",
          429,
        );
    }
  }
}
