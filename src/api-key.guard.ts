import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config";
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!config.ADMIN_API_KEY) return true;
    const header: unknown = context.switchToHttp().getRequest().headers[
      "x-api-key"
    ];
    const expected = Buffer.from(config.ADMIN_API_KEY);
    const actual = Buffer.from(typeof header === "string" ? header : "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException();
    return true;
  }
}
