import { Injectable } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
@Injectable()
export class S3Service {
  private options = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    ...(config.S3_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          },
        }
      : {}),
    requestChecksumCalculation: "WHEN_REQUIRED" as const,
  };
  private client = new S3Client({
    ...this.options,
    endpoint: config.S3_ENDPOINT,
  });
  private signer = new S3Client({
    ...this.options,
    endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
  });
  async uploadUrl(key: string, mimeType: string, size: number) {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        ContentType: mimeType,
        ContentLength: size,
      }),
      {
        expiresIn: config.S3_URL_TTL_SECONDS,
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
  }
  head(key: string) {
    return this.client.send(
      new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    );
  }
  copy(source: string, key: string, etag: string) {
    return this.client.send(
      new CopyObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        CopySource: `${config.S3_BUCKET}/${source.split("/").map(encodeURIComponent).join("/")}`,
        CopySourceIfMatch: etag,
      }),
    );
  }
  async downloadUrl(key: string, name: string) {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
      }),
      { expiresIn: config.S3_URL_TTL_SECONDS },
    );
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    );
  }
  onModuleDestroy() {
    this.client.destroy();
    this.signer.destroy();
  }
}
