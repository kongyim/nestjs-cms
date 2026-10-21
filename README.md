# NestJS CMS backend

第一部分：以 resource definitions 驅動嘅 CMS API。參考 `polyu-souvenirs/src/modules/resource` 同 `polyu-souvenirs/resources`，保留 Zod schema、集中 resource config、hooks 同通用 CRUD；業務邏輯放喺 resource definitions，唔放入核心 service。

## 快速開始

需要 Node.js 22+、npm 同 Docker Compose。

```sh
npm ci
cp .env.example .env
docker compose up -d --build
# 等 postgres、minio healthy，同 minio-init 成功退出（exit 0）
docker compose ps -a
npm run seed
npm run dev
```

API：`http://localhost:3000/api`。MinIO console：`http://localhost:9001`（development 帳密見 `.env.example`）。首次 MinIO build 會編譯官方 pinned source，需要下載 Go dependencies。Docker Hub / Quay 的原有 MinIO image 已無法拉取，因此本 project 自行 build；只作本機 development 使用。

```sh
curl http://localhost:3000/api/_resources
curl http://localhost:3000/api/articles
curl -X POST http://localhost:3000/api/articles \
  -H 'Content-Type: application/json' \
  -d '{"title":"First article","slug":"first-article"}'
```

預設 `.env` 開啟 development schema synchronization；正式環境必須關閉並使用 migrations。預設只 bind `127.0.0.1`。未設定 `ADMIN_API_KEY` 時開放本機 API；設定後所有 API 需要 `X-API-Key`。**未實作 user login、roles 或 resource rights**；shared key 係過渡用，唔係完整 authentication 系統。

## 已提供

- Resource discovery：JSON Schema、可篩選／排序欄位、attachment 設定，供 admin portal 使用。
- 通用 list/get/create/update/delete，Zod 驗證、分頁、allowlist filters / sort。
- 六個 lifecycle hooks，before/after hooks 與寫入共享 transaction。
- Single / multiple attachments：presigned PUT → complete → presigned GET，檔案唔會經 backend filesystem。
- PostgreSQL demo/test database；相同 TypeORM definitions 支援 MySQL 8.4。
- Demo `categories` / `articles`，multilingual JSON、foreign key、hooks 範例。
- Private MinIO bucket、staging expiration、可重試 cleanup、portable initial migration。

## 文件

- [Resource definitions 與 hooks](docs/resources.md)
- [API contract 與 admin portal 範例](docs/api.md)
- [S3、MinIO、資料庫與部署](docs/operations.md)

## 測試

使用 Prettier 統一格式：`npm run format` 自動修正，`npm run format:check` 只檢查（可用於 CI）。設定見 `.prettierrc.json`；build output、dependencies 同 environment files 會略過。

VS Code 開啟本 project 後，安裝 workspace 推薦嘅 **Prettier - Code formatter** extension（`esbenp.prettier-vscode`），儲存檔案時就會自動格式化。Workspace 設定已放喺 `.vscode/settings.json`，會使用本 project 嘅 Prettier config。

```sh
npm run build
npm test
# 使用獨立 cms_test DB；不會清空 cms demo DB
npm run test:integration
# 同一套 integration suite 驗證 MySQL
docker compose --profile mysql up -d mysql
DB_TYPE=mysql DB_PORT=3307 npm run test:integration
```

Docker 初始化時建立 `cms_test`；若使用已有 volume，請自行建立該 test database 並授權 cms user。Integration tests 透過 migration 建表，以實際 SQL database 及 MinIO 測試 HTTP API、hooks rollback、直接上傳、signed download、replacement、cross-record 拒絕及 cleanup。測試會建立並清理自己嘅 records。

## 範圍

今次只做 resource module。原有專案嘅 import/export、image resize、encrypted/hashed fields、nested relation expansion、legacy i18n 欄位映射及權限系統未搬入；本版本以 nested JSON 保存 multilingual/object fields。API 亦非原專案 drop-in replacement，差異見 resource 文件。其餘兩個部分可喺之後加入。
