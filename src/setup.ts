import { INestApplication } from "@nestjs/common";
import { config } from "./config";

/** Optional host bootstrap helper: configure CORS and shutdown signals. */
export function configureCmsApp(app: INestApplication): void {
  app.enableCors({
    origin: config.CORS_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowedHeaders: ["Content-Type", "X-API-Key"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  app.enableShutdownHooks();
}
