import "dotenv/config";
import { z } from "zod";
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  ADMIN_API_KEY: z.string().default(""),
  DB_TYPE: z.enum(["postgres", "mysql"]).default("postgres"),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_USERNAME: z.string().default("cms"),
  DB_PASSWORD: z.string().default("cms_dev_password"),
  DB_DATABASE: z.string().default("cms"),
  DB_SYNCHRONIZE: bool.default(false),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("cms-attachments"),
  S3_ENDPOINT: z.url().optional(),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(1024 ** 3)
    .default(20 * 1024 ** 2),
});
export function readConfig(input: NodeJS.ProcessEnv = process.env) {
  const config = env.parse(input);
  if (!!config.S3_ACCESS_KEY_ID !== !!config.S3_SECRET_ACCESS_KEY)
    throw new Error(
      "Set both S3 credentials or neither (IAM credential chain)",
    );
  if (config.NODE_ENV === "production" && config.DB_SYNCHRONIZE)
    throw new Error("DB_SYNCHRONIZE is forbidden in production");
  if (config.NODE_ENV === "production" && config.ADMIN_API_KEY.length < 32)
    throw new Error(
      "Production requires ADMIN_API_KEY of at least 32 characters until an authentication module is installed",
    );
  return config;
}
export const config = readConfig();
