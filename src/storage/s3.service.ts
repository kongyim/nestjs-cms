import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { config } from "../config";
@Injectable()
export class S3Service {
  private client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    ...(config.S3_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          },
        }
      : {}),
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  async upload(key: string, body: Buffer, mimeType: string) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: mimeType,
          ContentLength: body.length,
        }),
        { abortSignal: AbortSignal.timeout(5 * 60 * 1000) },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Object storage upload unavailable",
      );
    }
  }
  async download(key: string): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      );
      if (!(result.Body instanceof Readable))
        throw new Error("Missing object stream");
      return result.Body;
    } catch {
      throw new ServiceUnavailableException("Attachment content unavailable");
    }
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    );
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}
