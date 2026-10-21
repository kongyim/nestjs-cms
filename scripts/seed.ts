import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ResourceService } from "../src/resource/resource.service";
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const service = app.get(ResourceService);
    let category = (
      await service.list("categories", {
        query: JSON.stringify({ slug: "news" }),
      })
    ).data[0];
    category ??= await service.create("categories", {
      slug: "news",
      name: { en: "News", tc: "最新消息" },
    });
    const existing = await service.list("articles", {
      query: JSON.stringify({ slug: "hello-cms" }),
    });
    if (!existing.data.length)
      await service.create("articles", {
        title: "Hello CMS",
        slug: "hello-cms",
        body: "A resource-driven CMS.",
        categoryId: category.id,
      });
    console.log("Demo data ready");
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
