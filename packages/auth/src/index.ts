export { CmsAuthModule, createAuthDataSource } from "./auth.module";
export type { CmsAuthOptions } from "./options";
export { AuthService } from "./auth.service";
export type { Identity } from "./auth.service";
export { Credential, Session } from "./auth.entities";

export type {
  AuthResourceExtension,
  AuthResourceExtensions,
} from "./resource-extension";
