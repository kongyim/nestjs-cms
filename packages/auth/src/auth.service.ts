import {
  BadRequestException,
  Injectable,
  Inject,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DataSource, LessThan } from "typeorm";
import { z, ResourceRegistry } from "@nestjs-cms/core";
import { Credential, Session } from "./auth.entities";
import { hashPassword, verifyPassword } from "./password";
import { AUTH_OPTIONS, ResolvedAuthOptions } from "./options";

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  roleId: string;
  active: boolean;
};
type RoleRow = { id: string; name: string; permissions: string[] };

export const cookieName = "cms_session";
export const passwordSchema = z.string().min(12).max(128);
export type Identity = {
  id: string;
  email: string;
  displayName: string;
  permissions: string[];
};
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;
  constructor(
    private readonly db: DataSource,
    private readonly registry: ResourceRegistry,
    @Inject(AUTH_OPTIONS) readonly options: ResolvedAuthOptions,
  ) {}

  async onModuleInit() {
    this.dummyHash = await hashPassword(randomBytes(32).toString("hex"));
    const email = this.options.bootstrapAdmin?.email;
    const password = this.options.bootstrapAdmin?.password;
    if (!email && !password) return;
    if (!email || !password || !passwordSchema.safeParse(password).success)
      throw new Error(
        "Bootstrap requires ADMIN_BOOTSTRAP_EMAIL and a password of 12–128 characters.",
      );
    // Only an empty users table may be bootstrapped; existing passwords are never reset.
    await this.db.transaction("SERIALIZABLE", async (manager) => {
      if (await manager.getRepository<UserRow>("users").count()) return;
      const roles = manager.getRepository<RoleRow>("roles");
      let role = await roles.findOneBy({ name: "Administrator" });
      if (!role)
        role = await roles.save({
          id: randomUUID(),
          ...this.registry.get("roles").schema.parse({
            name: "Administrator",
            permissions: [...this.options.permissions],
          }),
        });
      if (
        !this.options.permissions.every((permission) =>
          role.permissions.includes(permission),
        )
      )
        throw new Error(
          "Existing Administrator role lacks bootstrap permissions.",
        );
      const user = this.registry.get("users").schema.parse({
        email,
        displayName:
          this.options.bootstrapAdmin?.displayName ?? "Administrator",
        roleId: role.id,
      });
      const id = randomUUID();
      await manager.getRepository<UserRow>("users").insert({ id, ...user });
      await manager
        .getRepository(Credential)
        .insert({ userId: id, passwordHash: await hashPassword(password) });
    });
  }

  async login(body: unknown) {
    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email().max(254),
        password: z.string().min(1).max(128),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new UnauthorizedException("Invalid email or password.");
    const user = await this.db
      .getRepository<UserRow>("users")
      .findOneBy({ email: parsed.data.email });
    const credential = user
      ? await this.db.getRepository(Credential).findOneBy({ userId: user.id })
      : null;
    const valid = await verifyPassword(
      parsed.data.password,
      credential?.passwordHash ?? this.dummyHash,
    );
    if (!valid || !user?.active || !credential)
      throw new UnauthorizedException("Invalid email or password.");
    const token = randomBytes(32).toString("hex");
    await this.db
      .getRepository(Session)
      .delete({ expiresAt: LessThan(new Date()) });
    await this.db.transaction(async (manager) => {
      const currentUser = await manager
        .getRepository<UserRow>("users")
        .findOne({
          where: { id: user.id },
          lock: { mode: "pessimistic_write" },
        });
      const currentCredential = await manager
        .getRepository(Credential)
        .findOneBy({ userId: user.id });
      if (
        !currentUser?.active ||
        currentCredential?.passwordHash !== credential.passwordHash
      )
        throw new UnauthorizedException("Invalid email or password.");
      await manager.getRepository(Session).insert({
        tokenHash: tokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + this.options.sessionLifetimeMs),
      });
    });
    return token;
  }

  async authenticate(token?: string): Promise<Identity> {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException();
    const session = await this.db
      .getRepository(Session)
      .findOneBy({ tokenHash: tokenHash(token) });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException();
    const user = await this.db
      .getRepository<UserRow>("users")
      .findOneBy({ id: session.userId, active: true });
    if (!user) throw new UnauthorizedException();
    const role = await this.db
      .getRepository<RoleRow>("roles")
      .findOneBy({ id: user.roleId });
    if (!role) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      permissions: role.permissions,
    };
  }

  async logout(token?: string) {
    if (token)
      await this.db
        .getRepository(Session)
        .delete({ tokenHash: tokenHash(token) });
  }

  async setPassword(id: string, body: unknown) {
    const parsed = z
      .object({ password: passwordSchema })
      .strict()
      .safeParse(body);
    if (!z.string().uuid().safeParse(id).success || !parsed.success)
      throw new BadRequestException(
        "Provide a valid user ID and a password of 12–128 characters.",
      );
    const passwordHash = await hashPassword(parsed.data.password);
    await this.db.transaction(async (manager) => {
      const user = await manager
        .getRepository<UserRow>("users")
        .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
      if (!user) throw new BadRequestException("User not found.");
      await manager
        .getRepository(Credential)
        .save({ userId: id, passwordHash });
      await manager.getRepository(Session).delete({ userId: id });
    });
    return { success: true };
  }
}
