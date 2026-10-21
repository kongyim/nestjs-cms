import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { config } from "./config";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: config.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowedHeaders: ["Content-Type", "X-API-Key"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, config.HOST);
}
bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
