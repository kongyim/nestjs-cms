import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  SetMetadata,
} from "@nestjs/common";
import type { Response, Request } from "express";
import { AuthService, cookieName } from "./auth.service";
import { sessionToken, type AuthRequest } from "./auth.guard";

const cookieOptions = (path: string) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path,
});

@Controller("api/auth")
@SetMetadata("nestjs-cms:auth-controller", true)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @SetMetadata("auth:public", "login")
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = await this.auth.login(body);
    await this.auth.logout(sessionToken(request));
    response.cookie(cookieName, token, {
      ...cookieOptions(this.auth.options.cookiePath),
      maxAge: this.auth.options.sessionLifetimeMs,
    });
    return this.auth.authenticate(token);
  }

  @Get("me")
  me(@Req() request: AuthRequest) {
    return request.identity;
  }

  @Post("logout")
  @HttpCode(200)
  @SetMetadata("auth:public", "logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(sessionToken(request));
    response.clearCookie(
      cookieName,
      cookieOptions(this.auth.options.cookiePath),
    );
    return { success: true };
  }

  @Put("users/:id/password")
  @SetMetadata("auth:permission", "users:manage")
  setPassword(@Param("id") id: string, @Body() body: unknown) {
    return this.auth.setPassword(id, body);
  }
}
