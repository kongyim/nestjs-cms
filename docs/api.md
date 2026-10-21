# API contract

Base URL：`http://localhost:3000/api`。JSON request 使用 `Content-Type: application/json`。如設定 `ADMIN_API_KEY`，所有 backend requests 加 `X-API-Key`；Browser 只需要連接 backend，所有附件流量都經 attachment API。

## Resources

| Method      | Path           | 說明                                                        |
| ----------- | -------------- | ----------------------------------------------------------- |
| GET         | /_resources    | Resource metadata、input JSON Schema、query/attachment 設定 |
| GET         | /:resource     | List（pagination + filtering + sorting）                    |
| GET         | /:resource/:id | Single record                                               |
| POST        | /:resource     | Create（201）                                               |
| PATCH / PUT | /:resource/:id | Partial update（200）                                       |
| DELETE      | /:resource/:id | Delete（200）                                               |

Create/get/update 回傳 record 本身：

```json
{
  "id": "1d6c78f9-9cd6-49b7-89e6-ff37ad5431d3",
  "title": "First article",
  "slug": "first-article",
  "body": "",
  "status": "draft",
  "categoryId": null,
  "createdAt": "2026-10-21T10:00:00.000Z",
  "updatedAt": "2026-10-21T10:00:00.000Z",
  "attachments": { "cover": null, "files": [] }
}
```

List 回傳 `{ data: [...], meta: { page, limit, total, totalPages } }`。預設 `page=1&limit=25`；limit 1–150；page 1–100000；唔接受 `limit=all`。無結果時 `totalPages=0`。同時有寫入時 count 同 data 可能輕微不同，並非 snapshot pagination。

`query` 係 URL-encoded JSON object。各欄位／operator 之間 AND，`$in` 內部 OR。只接受 definition 嘅 filterable 欄位同 `id`。Operators 統一用 `$` 前綴：`$eq`、`$in`、`$contains`、`$gt`、`$gte`、`$lt`、`$lte`、`$locate`；唔支援 nested relation、arbitrary SQL、OR tree。`$eq: null` 對應 SQL IS NULL。`$contains` 係 literal substring（會 escape `%` / `_`），大小寫跟 database collation；只用於 string 欄位。數字比較／日期比較需使用對應欄位類型。

直接值仍然係 equality shorthand，例如 `{ "status": "published" }` 等同 `{ "status": { "$eq": "published" } }`。舊 unprefixed operators（例如 `{ "title": { "contains": "Nest" } }`）會回 400；正確拼法係 `$contains`，唔接受 `$contians`。真實欄位名稱如 `eq` / `in` 可照常出現在最外層，只需列入 resource filterable allowlist。

```sh
curl -G http://localhost:3000/api/articles \
  --data-urlencode 'query={"status":"published","title":{"$contains":"Nest"}}' \
  --data-urlencode 'sort=createdAt:desc' \
  --data-urlencode 'page=1' --data-urlencode 'limit=25'
```

### `$locate`：搜尋第一次出現嘅位置

只支援 string 欄位。`{ "title": { "$locate": { "search": "Nest" } } }` 同簡寫 `{ "title": { "$locate": "Nest" } }` 都會選出有出現 `Nest` 嘅 records（預設位置 `$gt: 0`）。進階格式用 `search` 指定文字，再用 `$eq` / `$gt` / `$gte` / `$lt` / `$lte` 比較位置；多個 comparisons 之間 AND。

```json
{
  "title": {
    "$locate": { "search": "Nest", "$eq": 1 }
  }
}
```

以上選出 `Nest` 第一次出現位置係 1 嘅 records。位置由 1 開始，搵唔到係 0；`$eq: 0` 表示無出現，`$gte: 5` 表示第一次出現喺第 5 個字元或之後。呢個係 filter，唔會額外回傳 position 欄位。Null 欄位嘅結果係 SQL NULL，唔會當成 0；如要篩選 null，使用欄位 `$eq: null`。

`search` 必須係非空字串；position comparisons 可省略，預設匹配任何搵到嘅位置。有提供 `$eq` / `$gt` / `$gte` / `$lt` / `$lte` 時，只套用指定條件，唔會額外加 `$gt: 0`；比較值必須係非負整數。`%` / `_` 係普通字元，唔係 wildcard，search 同位置全部 parameterized。PostgreSQL 使用 [STRPOS](https://www.postgresql.org/docs/17/functions-string.html)，MySQL 使用 [LOCATE](https://dev.mysql.com/doc/refman/8.4/en/string-functions.html#function_locate)；大小寫／collation 行為跟 database，唔保證兩邊一致。

`sort=field:asc` 或 `field:desc`；預設 createdAt:desc。只允許 sortable 欄位、id 同 createdAt，另以 id 穩定排序。Delete 回 `{ id, deleted: true }`；刪除不存在 record 回 404。

## Attachments

所有 upload/download/delete 都經 backend：`Browser → Attachment API → S3 / MinIO`。Browser 唔會收到 S3 URL、bucket 或 object key，亦唔需要連接 storage endpoint。所有 attachment path 綁定 resource、record、field 同 attachment ID；跨 record 存取會 404。

| Method | Path                                            | 說明                                                          |
| ------ | ----------------------------------------------- | ------------------------------------------------------------- |
| POST   | /:resource/:id/attachments/:field               | multipart upload；field 名稱為 `file`，成功回 metadata（201） |
| GET    | /:resource/:id/attachments/:field/:attachmentId | 直接 stream 檔案內容（200），唔係 JSON 或 redirect            |
| DELETE | /:resource/:id/attachments/:field/:attachmentId | Detach，回 `{ id, deleted: true }`，storage cleanup 可重試    |

每次 POST 一個 file；multiple attachment field 可重複 POST。唔接受其他 multipart fields，size 以 backend 實際收到嘅 bytes 計算。只接受 definition 允許嘅 MIME types；大小受 global `ATTACHMENT_MAX_BYTES` 同 field `maxBytes` 較小者限制。MIME allowlist 檢查係 client 提供嘅 multipart Content-Type，未做內容偵測／病毒掃描。

```sh
curl -X POST http://localhost:3000/api/articles/ARTICLE_ID/attachments/cover \
  -F 'file=@photo.png;type=image/png'
curl http://localhost:3000/api/articles/ARTICLE_ID/attachments/cover/ATTACHMENT_ID \
  --output photo.png
```

Upload 回傳 `{ id, name, mimeType, size, createdAt }`；無額外 complete 步驟。Single field 新 upload 成功寫入 S3 並 commit 後先取代舊附件；upload 失敗仍保留舊附件。Multiple fields append。Download 使用 metadata 嘅 Content-Type、Content-Length 同 `Content-Disposition: attachment`，加 `Cache-Control: private, no-store` 同 `X-Content-Type-Options: nosniff`。

### Admin portal JavaScript

```js
const apiBase = "/api"; // same-origin frontend
// 若啟用 shared API key，加 { 'X-API-Key': key }；日後改用 user auth。
const authHeaders = {};
async function uploadAttachment(resource, recordId, field, file) {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(
    `${apiBase}/${resource}/${recordId}/attachments/${field}`,
    {
      method: "POST",
      headers: authHeaders,
      body: data,
    },
  );
  // 唔好自行設定 Content-Type，browser 需要加 multipart boundary。
  if (!response.ok) throw new Error("Attachment upload failed");
  return response.json();
}
async function downloadAttachment(
  resource,
  recordId,
  field,
  attachmentId,
  name,
) {
  const response = await fetch(
    `${apiBase}/${resource}/${recordId}/attachments/${field}/${attachmentId}`,
    {
      headers: authHeaders,
    },
  );
  if (!response.ok) throw new Error("Attachment download failed");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Frontend 同 API same origin 時，可設定 `CORS_ORIGINS=`。跨 origin 部署只需設定 backend CORS；S3／MinIO 唔需要 browser CORS。Delete／replace commit 後新 download request 即回 404；已開始傳送嘅 response 不會被追溯取消。

舊 `/uploads` 同 `/:attachmentId/complete` endpoints 已移除，改用上面一個 multipart POST。現有 ready attachments 繼續透過新 GET 下載，無需改 object keys 或 database schema。升級前已發出嘅 presigned URL 不能由應用程式即時撤銷，會按原有期限過期；新 API 唔再簽發 URL。

## Errors

- 400：Zod validation、invalid ID/query、缺少檔案／不允許嘅 MIME type。
- 401：缺少／錯誤 API key（如啟用）。
- 404：resource、record、attachment 不存在。
- 409：unique／foreign-key constraint conflict。
- 413：附件超過 global 或 field size limit。
- 500：未預期錯誤（包括 hook 錯誤），唔回傳 SQL／stack。
- 503：S3 upload/download 不可用或 metadata 指向嘅物件缺失。

Zod errors 回 `{ "message": "Validation failed", "issues": [...] }`；一般 HTTP errors 回 `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`。Client 應按 HTTP status 判斷失敗。
