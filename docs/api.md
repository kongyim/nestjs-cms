# API contract

Base URL：`http://localhost:3000/api`。JSON request 使用 `Content-Type: application/json`。如設定 `ADMIN_API_KEY`，所有 backend requests 加 `X-API-Key`；唔好將呢個 header 傳去 S3 signed URL。

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

`query` 係 URL-encoded JSON object。各欄位／operator 之間 AND，`in` 內部 OR。只接受 definition 嘅 filterable 欄位同 `id`。目前提供 `eq`、`in`、`contains`、`gt`、`gte`、`lt`、`lte`；唔支援 nested relation、arbitrary SQL、OR tree。`eq: null` 對應 SQL IS NULL。`contains` 係 literal substring（會 escape `%` / `_`），大小寫跟 database collation；只用於 string 欄位。數字比較／日期比較需使用對應欄位類型。

```sh
curl -G http://localhost:3000/api/articles \
  --data-urlencode 'query={"status":"published","title":{"contains":"Nest"}}' \
  --data-urlencode 'sort=createdAt:desc' \
  --data-urlencode 'page=1' --data-urlencode 'limit=25'
```

`sort=field:asc` 或 `field:desc`；預設 createdAt:desc。只允許 sortable 欄位、id 同 createdAt，另以 id 穩定排序。Delete 回 `{ id, deleted: true }`；刪除不存在 record 回 404。

## Attachments

所有 attachment path 都綁定 resource、record、field 同 attachment ID；跨 record 嘗試會 404。

| Method | Path                                                     | 說明                                   |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| POST   | /:resource/:id/attachments/:field/uploads                | 申請 presigned PUT URL（201）          |
| POST   | /:resource/:id/attachments/:field/:attachmentId/complete | 驗證並確認（201，idempotent）          |
| GET    | /:resource/:id/attachments/:field/:attachmentId          | 取得 metadata + presigned download URL |
| DELETE | /:resource/:id/attachments/:field/:attachmentId          | Detach／取消 pending upload，排程清理  |

Initiate body：`{ "name": "photo.png", "mimeType": "image/png", "size": 12345 }`。檔名不可有 path/control characters；size 係 bytes。回傳 `{ id, method: "PUT", url, headers: { "Content-Type": "image/png" }, expiresAt }`。

直接向 url PUT **檔案本身**，唔係 FormData。Content-Type 同 Content-Length 會納入 signature；browser 會按 File/Blob 自動提供 Content-Length，唔好手動設定 browser 禁止嘅 header。非 browser client 需要正確 Content-Length。過期要重新 initiate。

Complete 驗證 S3 HEAD metadata，透過 ETag conditional copy 將 staging object 複製到正式 key；正式 key 唔會有 upload URL。MIME 驗證係 header allowlist，唔代表 content sniffing 或病毒掃描。Single field 只有一個 ready attachment；新 upload 未 complete 前舊附件仍有效，新 complete 成功先取代。Multiple fields append，按 createdAt / id 排序。

Download 回 `{ id, name, mimeType, size, createdAt, url, expiresIn }`。回傳 JSON 而唔係 redirect／proxy。URL 有期限；UI 應適時刷新。下載預設 `Content-Disposition: attachment`，方便安全處理未可信任檔案。

### Admin portal JavaScript

```js
const apiBase = "http://localhost:3000/api";
// Development/integration key only; replace with user auth when that module exists.
const headers = { "Content-Type": "application/json" };
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Request failed");
  return result;
}
async function uploadAttachment(resource, recordId, field, file) {
  const base = `${apiBase}/${resource}/${recordId}/attachments/${field}`;
  const upload = await json(`${base}/uploads`, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      size: file.size,
    }),
  });
  const result = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!result.ok) throw new Error("S3 upload failed");
  return json(`${base}/${upload.id}/complete`, { method: "POST" });
}
async function downloadAttachment(resource, recordId, field, attachmentId) {
  return json(
    `${apiBase}/${resource}/${recordId}/attachments/${field}/${attachmentId}`,
  );
}
```

Backend CORS 同 S3 CORS 都要允許 admin portal origin。Delete 即時令 API 拒絕讀取，但已簽發 download URL 直到物件清除或 URL 過期前可能仍然有效。

## Errors

- 400：Zod validation、invalid ID/query、未上傳／過期／metadata mismatch。
- 401：缺少／錯誤 API key（如啟用）。
- 404：resource、record、attachment 不存在。
- 409：unique／foreign-key constraint conflict。
- 500：未預期錯誤（包括 hook 錯誤），唔回傳 SQL／stack。
- 503：檢查 upload 時 object storage 不可用。

Zod errors 回 `{ "message": "Validation failed", "issues": [...] }`；一般 HTTP errors 回 `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`。Client 應按 HTTP status 判斷失敗。
