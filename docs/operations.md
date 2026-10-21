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
| S3_PUBLIC_ENDPOINT                      | Browser 可接達嘅 endpoint，預設等同 S3_ENDPOINT                         |
| S3_FORCE_PATH_STYLE                     | MinIO 用 true，AWS S3 通常 false                                        |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | 要同時提供；兩者省略時使用 AWS credential chain / IAM role              |
| S3_URL_TTL_SECONDS                      | 預設 300，範圍 30–3600                                                  |
| ATTACHMENT_MAX_BYTES                    | 預設 20 MiB；最大 1 GiB，field maxBytes 可以再收窄                      |

API 喺 host 跑時 `.env.example` endpoint 係 `http://127.0.0.1:9000`。若之後將 API 放入同一 compose network，internal endpoint 設 `http://minio:9000`，public endpoint 維持 browser 可接達地址。唔可以簽完 URL 後自行替換 hostname，會破壞 signature。

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

## S3 upload lifecycle

1. Initiate：驗證 resource、record、field、檔名、size、MIME；建立 pending metadata，簽發 staging PUT。
2. Client：直接 PUT 原始 bytes 去 S3，backend 唔接收 file body。
3. Complete：鎖 parent，驗證 pending ownership／expiry；HEAD size/type；以 ETag conditional copy 複製到正式 key；更新 ready metadata。
4. Download：只為 ready 附件簽發短期 GET URL。
5. Delete／replace：transaction 內標記 deleted，立即從 API 輸出移除，cleanup 處理物件刪除。

Single replacement 同 multiple append 都鎖同一 parent，避免同時完成時 lost updates。Complete 重試同一 ready ID 會回 metadata。已取代／刪除嘅 ID 不能重新 complete。

S3 與 SQL 無分散式 transaction。Copy 成功但 SQL rollback 時，pending metadata 仍保留，cleanup 會刪除 staging 同 final key。S3 delete 成功但 SQL commit 失敗時，重試 delete 仍然 idempotent。唔會喺 SQL transaction 完成前永久刪除被取代物件。

## Cleanup

```sh
npm run storage:cleanup
# compiled deployment
node dist/scripts/cleanup.js
```

請由 scheduler/cron 定時執行，例如每 15 分鐘；本專案唔會自動安裝 cron。處理過期至少一小時嘅 metadata：ready 只清 staging；pending/deleted 清 staging + final object，成功後刪 metadata。失敗保留 row，下次重試；CLI 有 failures 時 exit code 1。

即使完成 upload，staging key 都保留至 URL 過期加 grace period，避免 presigned URL 重用產生遺留物件。MinIO init 已加 `staging/` 一日 expiration lifecycle；AWS bucket 亦應設定同樣 rule，覆蓋極慢／遲完成 upload。正式 `attachments/` 唔設定 blanket expiration。版本控制 bucket 要另外設定 noncurrent version expiration，因為 DeleteObject 只建立 delete marker。

目前 cleanup 係簡單批次 CLI，會 scan 過期 metadata，包括 ready rows；大型部署可改為有 cursor 嘅 batch worker。Cleanup service 唔自動掃描未記錄於 DB 嘅任意 bucket key；不要手動刪 metadata 或改寫 storage prefix。

## AWS S3 配置

```dotenv
S3_REGION=ap-east-1
S3_BUCKET=your-private-cms-bucket
S3_FORCE_PATH_STYLE=false
# 省略 S3_ENDPOINT、S3_PUBLIC_ENDPOINT
# 使用 IAM role 時亦省略 S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY
```

Bucket 需預先建立，保持 Block Public Access。Runtime principal 要有 bucket `staging/*` 同 `attachments/*` 嘅 `s3:PutObject`、`s3:GetObject`、`s3:DeleteObject`；copy 需要 source GetObject 同 destination PutObject。使用 SSE-KMS 時另加對應 KMS permissions。S3 相容服務必須支援 HEAD、conditional CopyObject 同 SigV4 signed PUT/GET。

AWS bucket CORS 範例（換成真實 admin origin）：

```json
[
  {
    "AllowedOrigins": ["https://admin.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

本機 MinIO 透過 compose `MINIO_API_CORS_ALLOW_ORIGIN` 配置 origins；要同步修改 backend `CORS_ORIGINS`。Development root credentials 同 local HTTP 只用喺本機，正式環境使用 HTTPS 同有範圍限制嘅 IAM principal。

Attachment MIME type 係 client 宣告後經 HEAD 比對，未做 magic-byte detection、virus scan、image resize 或 multipart upload。需要呢啲能力時可喺 staging → ready 之間加入處理。單次 PUT 適合本次 20 MiB 預設上限。

## 參考

- [TypeORM EntitySchema](https://typeorm.io/docs/entity/separating-entity-definition/)
- [TypeORM transactions](https://orkhan.gitbook.io/typeorm/docs/transactions)
- [AWS presigned upload semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)：signed URL 可喺有效期內重用，同 key 會覆寫，所以本設計將 staging 同正式 key 分開。
- [MinIO pinned release / source build instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
