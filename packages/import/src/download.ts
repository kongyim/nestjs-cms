import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AttachmentField, UploadedAttachment } from "@nestjs-cms/core";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const ipv6Global = new BlockList();
ipv6Global.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        ipv6Global.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export function attachmentUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Expected an HTTP(S) file URL without credentials.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw new Error("Attachment URLs must use public addresses.");
  url.hash = "";
  return url;
}

/** Pin the checked DNS address on every hop, limit bytes and never forward credentials. */
export async function downloadAttachment(
  source: string,
  field: AttachmentField,
  maxBytes: number,
): Promise<UploadedAttachment> {
  const signal = AbortSignal.timeout(30_000);
  async function read(
    url: URL,
    redirects: number,
  ): Promise<UploadedAttachment> {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("Attachment download timed out."));
        else
          signal.addEventListener(
            "abort",
            () => reject(new Error("Attachment download timed out.")),
            { once: true },
          );
      }),
    ]);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new Error("Attachment URLs must resolve to public addresses.");
    const address = addresses[0];
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          signal,
          headers: { Accept: field.mimeTypes.join(", ") },
          lookup: ((
            _host: string,
            options: { all?: boolean },
            callback: Function,
          ) =>
            options.all
              ? callback(null, [address])
              : callback(null, address.address, address.family)) as any,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            response.destroy();
            if (!response.headers.location || redirects >= 5)
              return reject(new Error("Too many or invalid file redirects."));
            try {
              resolve(
                read(
                  attachmentUrl(new URL(response.headers.location, url).href),
                  redirects + 1,
                ),
              );
            } catch (error) {
              reject(error);
            }
            return;
          }
          const mimeType = String(response.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          if (status !== 200 || !field.mimeTypes.includes(mimeType)) {
            response.destroy();
            reject(
              new Error(
                "File URL must return a successful response with an allowed MIME type.",
              ),
            );
            return;
          }
          if (Number(response.headers["content-length"]) > maxBytes) {
            response.destroy();
            reject(new Error("Attachment exceeds field size limit."));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("error", reject);
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              response.destroy(
                new Error("Attachment exceeds field size limit."),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              if (!size) throw new Error("Attachment is empty.");
              const disposition = response.headers["content-disposition"] ?? "";
              const encoded = /filename\*=UTF-8''([^;]+)/i.exec(
                disposition,
              )?.[1];
              const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
              const name = encoded
                ? decodeURIComponent(encoded)
                : (plain ??
                  decodeURIComponent(
                    url.pathname.split("/").pop() || "attachment",
                  ));
              const originalname =
                name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 255) ||
                "attachment";
              resolve({
                originalname,
                mimetype: mimeType,
                buffer: Buffer.concat(chunks),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
  }
  try {
    return await read(attachmentUrl(source), 0);
  } catch {
    throw new Error(
      "Could not download attachment. Use a public direct file URL with an allowed MIME type and size.",
    );
  }
}
