# API contract

Base URL: `http://localhost:3000/api`. Use `Content-Type: application/json` for JSON requests. When `ADMIN_API_KEY` is configured, include `X-API-Key` in every backend request. Browsers communicate only with the backend; all attachment traffic goes through the attachment API.

## Resources

| Method      | Path           | Behavior                                                            |
| ----------- | -------------- | ------------------------------------------------------------------- |
| GET         | /_resources    | Resource metadata, input JSON Schema, query and attachment settings |
| GET         | /:resource     | List with pagination, filtering, and sorting                        |
| GET         | /:resource/:id | Get one record                                                      |
| POST        | /:resource     | Create a record; returns 201                                        |
| PATCH / PUT | /:resource/:id | Partially update a record; returns 200                              |
| DELETE      | /:resource/:id | Delete a record; returns 200                                        |

Create/get/update return the record itself:

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

List returns `{ data: [...], meta: { page, limit, total, totalPages } }`. Defaults are `page=1&limit=25`. Limits are 1–150 items and pages 1–100000. `limit=all` is not supported. Empty results have `totalPages=0`. The count and data may differ slightly under concurrent writes; pagination is not a database snapshot.

### Filtering and sorting

`query` is a URL-encoded JSON object. Conditions across fields and operators are combined with AND; values inside `$in` are alternatives. Only the resource's `filterable` fields and `id` are accepted.

Operators use a `$` prefix: `$eq`, `$in`, `$contains`, `$gt`, `$gte`, `$lt`, `$lte`, and `$locate`. Nested relation queries, arbitrary SQL, and OR trees are not supported. `$eq: null` translates to SQL IS NULL. `$contains` searches a literal substring, escaping `%` and `_`; use it on string fields. Case sensitivity follows database collation. Comparison values must suit the target column type.

A direct value is equality shorthand: `{ "status": "published" }` is equivalent to `{ "status": { "$eq": "published" } }`. Unprefixed operators such as `{ "title": { "contains": "Nest" } }` return 400. The correct spelling is `$contains`; `$contians` is not accepted. Real fields named `eq` or `in` can still appear at the top level if included in the filter allowlist.

```sh
curl -G http://localhost:3000/api/articles \
  --data-urlencode 'query={"status":"published","title":{"$contains":"Nest"}}' \
  --data-urlencode 'sort=createdAt:desc' \
  --data-urlencode 'page=1' --data-urlencode 'limit=25'
```

Sort with `sort=field:asc` or `field:desc`; the default is `createdAt:desc`. Only declared sortable fields, `id`, and `createdAt` are accepted. An additional `id` sort makes ties deterministic. Delete returns `{ id, deleted: true }`; deleting a missing record returns 404.

### `$locate`: find the first substring position

`$locate` supports string columns only. These forms both match records containing `Nest` anywhere, using a default position comparison of `$gt: 0`:

```json
{ "title": { "$locate": { "search": "Nest" } } }
```

```json
{ "title": { "$locate": "Nest" } }
```

To filter by position, provide `search` and one or more of `$eq`, `$gt`, `$gte`, `$lt`, or `$lte`. Multiple comparisons are combined with AND:

```json
{
  "title": {
    "$locate": { "search": "Nest", "$eq": 1 }
  }
}
```

This selects records whose first occurrence of `Nest` begins at position 1. Positions start at 1; a missing substring produces 0. `$eq: 0` means not found, and `$gte: 5` means the first occurrence starts at the fifth character or later. This filters records; it does not add a position field to the response. A null column produces SQL NULL rather than 0; use the field's `$eq: null` to select nulls.

`search` must be a nonempty string. Position comparisons are optional, but when supplied, only those conditions apply: no implicit `$gt: 0` is added. Comparison values must be nonnegative integers. `%` and `_` are literal characters, not wildcards. Search text and positions are parameterized.

PostgreSQL uses [STRPOS](https://www.postgresql.org/docs/17/functions-string.html); MySQL uses [LOCATE](https://dev.mysql.com/doc/refman/8.4/en/string-functions.html#function_locate). Case and collation behavior follow the database and are not guaranteed to be identical.

## Attachments

All uploads, downloads, and deletes go through `Browser → Attachment API → S3 / MinIO`. Browsers do not receive S3 URLs, bucket names, or object keys, and do not need access to the storage endpoint. Each attachment path is bound to its resource, record, field, and attachment ID. Access through a different record returns 404.

| Method | Path                                            | Behavior                                                                               |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| POST   | /:resource/:id/attachments/:field               | Multipart upload using the `file` field; returns metadata with 201                     |
| GET    | /:resource/:id/attachments/:field/:attachmentId | Streams file bytes with 200, not JSON or a redirect                                    |
| DELETE | /:resource/:id/attachments/:field/:attachmentId | Detaches the attachment; returns `{ id, deleted: true }`; storage cleanup is retryable |

Send one file per POST. Repeat POST to add files to a multiple-attachment field. Other multipart fields are rejected. Size is determined from the bytes received by the backend. The MIME type must be allowed by the resource definition, and the size must satisfy both `ATTACHMENT_MAX_BYTES` and the field's `maxBytes`. MIME validation checks the client-supplied multipart Content-Type; it does not inspect file contents or scan for malware.

Replace the ID placeholders and local filename in these examples:

```sh
curl -X POST http://localhost:3000/api/articles/ARTICLE_ID/attachments/cover \
  -F 'file=@photo.png;type=image/png'
curl http://localhost:3000/api/articles/ARTICLE_ID/attachments/cover/ATTACHMENT_ID \
  --output photo.png
```

Upload returns `{ id, name, mimeType, size, createdAt }`. No completion request is required. A single attachment is replaced only after the new object is stored and its metadata committed; failed uploads retain the previous attachment. Multiple fields append attachments.

Downloads use the metadata's Content-Type and Content-Length, with `Content-Disposition: attachment`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.

### Frontend JavaScript

```js
const apiBase = "/api"; // Same-origin frontend.
// Add { "X-API-Key": key } if enabled; replace with user auth when available.
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
  // Let the browser set Content-Type, including the multipart boundary.
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

For a same-origin frontend and API, set `CORS_ORIGINS=`. A frontend on another origin requires backend CORS configuration. S3/MinIO does not require browser CORS. Once deletion or replacement commits, new requests for the old attachment return 404. Responses already streaming are not retroactively cancelled.

The former `/uploads` and `/:attachmentId/complete` endpoints were removed in favor of a single multipart POST. Existing ready attachments remain downloadable through the new GET route without changing object keys or the database schema. Previously issued presigned URLs expire according to their original lifetime; the application no longer issues new ones.

## Errors

- 400: Zod validation failure, invalid ID/query, missing file, or unsupported MIME type.
- 401: Missing or incorrect API key when enabled.
- 404: Resource, record, or attachment not found.
- 409: Unique or foreign-key constraint conflict.
- 413: Attachment exceeds the global or field size limit.
- 500: Unexpected error, including hook failures; SQL and stack traces are not returned.
- 503: S3 upload/download unavailable, or metadata points to missing object content.

Zod errors return `{ "message": "Validation failed", "issues": [...] }`. Other HTTP errors typically return `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`. Clients should use the HTTP status to determine failure.
