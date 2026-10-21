import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { AttachmentService } from "../src/storage/attachment.service";
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(AttachmentService).cleanup();
    console.log(result);
    if (result.failures.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
