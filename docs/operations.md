# Development、storage 與 deployment

## Environment

所有 runtime 設定由 `.env` 讀取並經 Zod 驗證；OS environment 優先。`.env` 不加入 version control。

| 設定                                    | 說明                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| NODE_ENV                                | development / test / production                                         |
| HOST / PORT                             | 預設 127.0.0.1 / 3000；container 部署設定 HOST=0.0.0.0                  |
| CORS_ORIGINS                            | 逗號分隔 admin portal origins                                           |
| ADMIN_API_KEY                           | optional shared key；production 暫時要求最少 32 chars，等待 auth module |
| DB_TYPE                                 | postgres / mysql                                                        |
| DB_HOST / DB_PORT                       | database endpoint；port 未提供按 driver 取預設                          |
| DB_USERNAME / DB_PASSWORD / DB_DATABASE | database credentials/name                                               |
| DB_SYNCHRONIZE                          | 只用於 development；production 啟用會 fail fast                         |
| S3_REGION / S3_BUCKET                   | S3 region 及已存在 private bucket                                       |
| S3_ENDPOINT                             | MinIO / S3-compatible endpoint；AWS S3 可省略                           |
| S3_FORCE_PATH_STYLE                     | MinIO 用 true，AWS S3 通常 false                                        |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | 要同時提供；兩者省略時使用 AWS credential chain / IAM role              |
| ATTACHMENT_MAX_BYTES                    | 預設 20 MiB；最大 1 GiB，field maxBytes 可以再收窄                      |

API 喺 host 跑時 `.env.example` endpoint 係 `http://127.0.0.1:9000`。如果 API 放入 compose network，設 `S3_ENDPOINT=http://minio:9000`。呢個 endpoint 只需 backend 接達；browser 唔會直接連接 S3／MinIO。已移除 `S3_PUBLIC_ENDPOINT` 同 `S3_URL_TTL_SECONDS` 設定。

## PostgreSQL / MySQL

預設 PostgreSQL 17，host port 5432。MySQL 8.4 係 optional compose profile，host port **3307**，避免同已有 MySQL port 3306 衝突。

```sh
docker compose --profile mysql up -d mysql
# 或修改 .env 對應項目
DB_TYPE=mysql DB_PORT=3307 DB_SYNCHRONIZE=true npm run seed
DB_TYPE=mysql DB_PORT=3307 npm run dev
```

兩個 database 都提供獨立 `cms` / `cms_test`。切換 driver 並唔會搬移資料。JSON storage、UUID varchar、一般 SQL column types、parameterized query 同 row locks 都使用 PG/MySQL 共同支援行為。搜尋 case sensitivity 依 database collation；唔保證兩邊相同。

## Migrations

已提供 portable initial migration（categories、articles、cms_attachments、foreign key）。對**全新空 database**：

```sh
DB_SYNCHRONIZE=false npm run db:migrate
```

已經用 synchronize 建過表嘅 development DB 唔好直接執行 initial migration；應使用新空 database，或者經人手 review 後建立 migration baseline。唔好喺有用資料嘅 DB 重建／reset。

修改 resource 後，在同 schema 嘅 development database 產生 migration：

```sh
DB_SYNCHRONIZE=false npm run db:generate -- src/database/migrations/AddPages
# review SQL，尤其 unique constraints、nullable 及資料轉換
DB_SYNCHRONIZE=false npm run db:migrate
```

TypeORM 自動產生 migration 通常係 driver-specific；需要同時維護 PG/MySQL 時，使用 QueryRunner Table/ForeignKey API 或按 driver 分支，並喺兩邊驗證。現有 initial migration 已使用此方式。MySQL DDL 會 implicit commit，唔好假設 schema changes 可以 transaction rollback。

Production build 包含 resources 同 migrations：

```sh
npm ci
npm run build
# 使用 production env / secret manager，DB_SYNCHRONIZE=false
node node_modules/typeorm/cli.js migration:run -d dist/src/database/data-source.js
npm start
```

## Attachment lifecycle

所有附件流量：`Browser → Attachment API → S3 / MinIO`。Browser 使用 multipart `file` POST；成功直接回 metadata，唔需要 initiate/complete。Download GET 直接 stream S3 bytes，唔簽發 URL 或 redirect。Delete 即時 detach，S3 object 由 cleanup 刪除。

1. Nest FileInterceptor 以 memory storage 接收一個 file，global size limit 預設 20 MiB；唔寫入 local filesystem。
2. Service 驗證 field、MIME type、實際 bytes、field limit、parent record，持久保存 pending metadata。
3. Backend PUT object 去 private S3 key，最多五分鐘，失敗回 503；pending row 保留作 cleanup。
4. 成功後鎖 parent 同 attachment row，在 transaction 內將 pending 轉 ready；single field 舊附件同時轉 deleted，multiple field append。
5. GET 每次先驗證 resource/record/field/attachment 同 ready status，再從 S3 stream response；資料唔會整個 buffer 喺 backend 記憶體。

上傳目前會將完整 file 暫存在記憶體，受 `ATTACHMENT_MAX_BYTES` 限制；並發上傳時需預留相應 RAM。反向代理嘅 request body size／timeout 亦要配合設定。下載以 stream 傳送；中途 storage/network failure 會中止 response，client 應重試。暫未提供 HTTP Range/resumable upload。

SQL 同 S3 並非跨系統 transaction：S3 成功但 SQL commit 失敗時，pending row 留俾 cleanup。Parent 喺上傳期間被刪除時，finalization 會失敗，已寫 object 同樣由 cleanup 移除。Single replacement 只會喺新附件 ready 時發生，唔會因為上傳失敗刪除舊附件。

保留既有 attachment table schema，無需 migration：新 row `stagingKey` 為空，`expiresAt` 記錄 pending 建立時間供 cleanup 使用。舊 ready attachments 保留 key，可繼續經新 API 讀取。舊 presigned URL 會按原期限過期，唔會再發出新 URL。

## Cleanup

```sh
npm run storage:cleanup
# compiled deployment
node dist/scripts/cleanup.js
```

由 scheduler/cron 定時執行，例如每 15 分鐘；本專案唔會自動安裝 cron。處理 `expiresAt` 已過至少一小時嘅 rows，避免同 active upload 競爭。Pending/deleted 刪 object 後刪 metadata；失敗保留 row，下次重試，CLI 有 failures 時 exit 1。Ready 只清理舊流程遺留嘅 staging key，唔會刪除正式 object。

MinIO init 保留 `staging/` 一日 expiration lifecycle，兼容舊 upload 可能留下嘅 objects；新 upload 唔會寫 staging。正式 `attachments/` 唔設定 blanket expiration。版本控制 bucket 需另外設定 noncurrent version expiration，因為 DeleteObject 只建立 delete marker。

目前 cleanup 係簡單批次 CLI，會 scan 過期 metadata，包括 ready rows；大型部署可改為有 cursor 嘅 batch worker。唔會掃描未記錄於 DB 嘅任意 bucket key，唔好手動刪除 metadata。

## AWS S3 配置

```dotenv
S3_REGION=ap-east-1
S3_BUCKET=your-private-cms-bucket
S3_FORCE_PATH_STYLE=false
# 省略 S3_ENDPOINT，使用 AWS 預設 endpoint
# 使用 IAM role 時亦省略 S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY
```

Bucket 預先建立，保持 Block Public Access。Backend principal 需要 `attachments/*` 嘅 `s3:PutObject`、`s3:GetObject`、`s3:DeleteObject`；清理舊 staging 時需要 `staging/*` DeleteObject。SSE-KMS 另加相應 KMS permissions。Development root credentials 同 HTTP 只用於本機。

Frontend 同 API same origin 時可設定 `CORS_ORIGINS=`。未設定則沿用 `http://localhost:5173` 預設值。跨 origin frontend 只需設定 backend `CORS_ORIGINS`；browser 唔直接存取 S3，因此 **不需要 S3 bucket／MinIO browser CORS**。

MIME validation 使用 multipart Content-Type，未做 magic-byte detection、virus scan、image resize。需要時可喺 metadata ready 前加入處理。

## 參考

- [NestJS file upload and streaming](https://docs.nestjs.com/techniques/file-upload)
- [TypeORM EntitySchema](https://typeorm.io/docs/entity/separating-entity-definition/)
- [TypeORM transactions](https://orkhan.gitbook.io/typeorm/docs/transactions)
- [MinIO pinned release / source build instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
