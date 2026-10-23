import type { Request, Response } from "express";
import { AuthController } from "../src/auth.controller";
import { AuthService, cookieName } from "../src/auth.service";
import { resolveOptions } from "../src/options";

describe("admin session cookie prefix", () => {
  const original = process.env.ADMIN_BASE_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_BASE_PATH;
    else process.env.ADMIN_BASE_PATH = original;
  });

  it.each([
    [undefined, "/admin/api"],
    ["/cms/", "/cms/api"],
    ["/tools/cms", "/tools/cms/api"],
    ["", "/api"],
  ])("uses %s consistently for login and logout", async (prefix, path) => {
    if (prefix === undefined) delete process.env.ADMIN_BASE_PATH;
    else process.env.ADMIN_BASE_PATH = prefix;
    const auth = {
      options: resolveOptions(
        {
          adminOrigin: "http://localhost:3001",
          adminBasePath: prefix,
          sessionLifetimeMs: 3600000,
        },
        [],
      ),
      login: jest.fn().mockResolvedValue("token"),
      logout: jest.fn().mockResolvedValue(undefined),
      authenticate: jest.fn().mockResolvedValue({ id: "user" }),
    };
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };
    const controller = new AuthController(auth as unknown as AuthService);
    const request = { headers: {} } as Request;
    await controller.login({}, request, response as unknown as Response);
    await controller.logout(request, response as unknown as Response);
    expect(response.cookie).toHaveBeenCalledWith(
      cookieName,
      "token",
      expect.objectContaining({ path, httpOnly: true }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      cookieName,
      expect.objectContaining({ path, httpOnly: true }),
    );
  });
});

it("sets secure cookies in production and preserves their attributes on logout", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const auth = {
      options: resolveOptions({ adminOrigin: "https://cms.example.com" }, []),
      login: jest.fn().mockResolvedValue("token"),
      logout: jest.fn().mockResolvedValue(undefined),
      authenticate: jest.fn().mockResolvedValue({ id: "user" }),
    };
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };
    const controller = new AuthController(auth as unknown as AuthService);
    const request = { headers: {} } as Request;
    await controller.login({}, request, response as unknown as Response);
    await controller.logout(request, response as unknown as Response);
    expect(response.cookie).toHaveBeenCalledWith(
      cookieName,
      "token",
      expect.objectContaining({
        secure: true,
        httpOnly: true,
        sameSite: "strict",
        maxAge: 28800000,
      }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      cookieName,
      expect.objectContaining({
        secure: true,
        httpOnly: true,
        sameSite: "strict",
      }),
    );
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
