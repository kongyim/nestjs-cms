# Resource definitions

## 新增 resource

1. 喺 `resources/` 建立檔案。
2. export Zod `schema` 及 `defineResource(...)`。
3. 重啟 development server，自動載入新 resource；唔需要 index 或手動註冊。

Loader 啟動時按檔名排序掃描 `resources/` 第一層：development 載入 `.ts`，compiled production 載入 `dist/resources/` 嘅 `.js`。每個 resource file 必須 default export `defineResource(...)`；helper files 用 `_` 開頭（例如 `_hooks.ts`、`_schema.ts`）。隱藏檔、declaration files、`.spec` / `.test` files 同子目錄會略過。無效 export 或重複 resource name 會令啟動失敗並指出檔案。

載入係 startup discovery，唔係每個 request 重新掃描；新增／移除檔案後需重啟 server。Production 需重新 build/deploy，並產生、review 及執行必要 database migration。`npm run build` 會先清理 `dist`，避免已刪除 resource 嘅舊 `.js` 被重新載入。Development 啟用 `DB_SYNCHRONIZE=true` 時，只加一個 resource file 即可自動建表同註冊 API。

唔需要另外寫 controller/service。資料庫欄位需明確定義：Zod 負責 API input contract；TypeORM columns 負責 SQL storage、indexes、unique constraints。兩者分開，避免由 Zod refinements 猜測 database constraints。

```ts
import { z } from "zod";
import { defineResource } from "../src/resource/resource.types";

export const schema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["draft", "published"]).default("draft"),
  })
  .strict();

export default defineResource({
  name: "pages",
  label: "Pages",
  schema,
  columns: {
    title: { type: String, length: 200 },
    status: { type: String, length: 20 },
  },
  filterable: ["title", "status"],
  sortable: ["title", "createdAt"],
  attachments: [
    {
      field: "cover",
      mimeTypes: ["image/png", "image/jpeg"],
      maxBytes: 5 * 1024 * 1024,
    },
  ],
  hooks: {
    onBeforeCreate: [
      ({ record }) => ({ ...record, title: String(record.title).trim() }),
    ],
  },
});
```

Resource name 使用小寫英文字母開頭，之後可包含數字／底線，亦用作 table name。框架加入 UUID string `id`、`createdAt`、`updatedAt`；呢啲欄位同 `attachments` 不可由 schema/columns 重定義或 client 寫入。所有正常 payload 欄位應同 columns 對應；nested object/arrays 用 `type: 'json'`。SQL type 要同時支援兩個 database，避免 postgres-only `jsonb`、array、enum 等。UUID 儲存為 varchar(36)。

Single attachments 用 `{ field, mimeTypes }`；multiple 加 `multiple: true`。Attachment 欄位唔放入 schema/columns，獨立保存 metadata；回應喺 `attachments[field]` 顯示 object/null 或 array。API payload 不接受 object key、bucket、attachment metadata。

`foreignKeys` 可宣告跨 resource 外鍵，參考 `articles.ts`。核心唔會自動 expand relations。`categoryId` 由 hook 預先驗證，再由 database foreign key 保證並發安全；使用中 category 不可刪除。

## 驗證與 update

Create 先執行 Zod（包括 defaults），之後 before hooks，再以完整 schema 驗證結果後寫 DB。Unknown fields 回 400，唔會偷偷存入 database。

PUT/PATCH 都係 **partial update**（配合原有 admin portal 風格）：省略欄位保留舊值，null 只接受 nullable 欄位。Nested JSON 整個欄位取代，唔會 deep merge。預設以 `schema.partial()` 驗證 patch，只取 client 真正提供嘅 keys，避免 Zod defaults 重設 omitted fields；合併 existing record 後再完整驗證。

如 schema 有 object-level refinements，Zod 可能唔允許 `.partial()`；請明確提供 `updateSchema`（例如冇 defaults 嘅 partial object），合併後仍會以完整 schema 驗證。需要供 discovery 使用嘅 schema 請使用可轉 JSON Schema 嘅 Zod types；複雜 transforms 可移到 hooks。Client-side JSON Schema 唔能代替 server-side refinements。

## Hooks

| Hook           | 時機                 | record                                 |
| -------------- | -------------------- | -------------------------------------- |
| onBeforeCreate | insert 前            | validated input + defaults             |
| onAfterCreate  | insert 後、commit 前 | persisted record                       |
| onBeforeUpdate | update 前            | existing + patch，完整 validated input |
| onAfterUpdate  | update 後、commit 前 | persisted record                       |
| onBeforeDelete | delete 前            | persisted record                       |
| onAfterDelete  | delete 後、commit 前 | 刪除前 record                          |

每個 hook 收到 `{ manager, resource, action, id, record, previous }`。`previous` 喺 update/delete 提供。Hooks 按 array 次序執行；before hook 可 mutate `record`，或者 return **完整 replacement record**。Before create/update 結果必須符合 schema。After hooks return value 唔會再寫入；如需寫其他 table，使用傳入嘅 `manager`。

```ts
const hook = async ({ manager, record, id }) => {
  await manager.getRepository("audit_logs").insert({
    resourceId: id,
    title: record.title,
  });
};
```

上述 `audit_logs` 需自行定義 table。所有 hook DB 操作必須用 context manager；唔好使用 global repository，否則操作唔屬於同一 transaction。任一 hook 拋錯，CRUD 同 manager 寫入都 rollback。Update/delete 鎖住 parent record；同一 record 嘅 attachment mutation 亦用相同鎖。After hooks 係 **after write, before commit**，唔係 after commit；email、webhook 等不可 rollback 外部動作應使用 transactional outbox，唔好直接喺 hook 發送。

Attachment upload/download/remove 不會觸發 CRUD hooks，也不會更新 parent `updatedAt`。Attachment storage 操作使用獨立 service，metadata transaction 同 S3 並非跨系統 atomic transaction，失敗時保留 pending/deleted rows 俾 cleanup 重試。

## 舊 project 對照

| 舊設定／行為                            | 本版本                                           |
| --------------------------------------- | ------------------------------------------------ |
| default config + named schema           | `defineResource({ schema, columns, ... })`       |
| Prisma `delegate`                       | TypeORM resource table/entity，同時支援 PG/MySQL |
| `prisma` hook context                   | transactional `manager`                          |
| `onBeforeCreate` 等六個 hooks           | 保留命名及順序；after hook 在 commit 前          |
| filesystem attachment、multipart upload | multipart API upload + API streaming download    |
| `fields[].attachment/attachments`       | `attachments: [{ field, multiple, mimeTypes }]`  |
| 平面 `nameEn/nameTc/nameSc` mapping     | JSON `name: { en, tc, sc }`                      |
| arbitrary ORM query、limit=all          | allowlisted filters、最多 150 items/page         |
| numeric/custom IDs                      | UUID string IDs                                  |
| rights、publicList                      | 暫不處理；所有 API 共用 optional API key         |
| products/orders 特例                    | 不移植；按新業務寫 resource hooks                |

唔支援舊 config 直接貼入無修改；呢個係獨立 resource framework。既有資料遷移亦唔喺本次範圍。
