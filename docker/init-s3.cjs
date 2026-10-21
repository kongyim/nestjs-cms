const {
  S3Client,
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
} = require("@aws-sdk/client-s3");
const client = new S3Client({
  endpoint: "http://minio:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin123" },
});
async function main() {
  const Bucket = "cms-attachments";
  try {
    await client.send(new CreateBucketCommand({ Bucket }));
  } catch (e) {
    if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(e.name))
      throw e;
  }
  // MinIO uses MINIO_API_CORS_ALLOW_ORIGIN; AWS S3 supports per-bucket CORS.
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "staging-expiry",
            Status: "Enabled",
            Filter: { Prefix: "staging/" },
            Expiration: { Days: 1 },
          },
        ],
      },
    }),
  );
  console.log("Private development bucket and staging lifecycle ready");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
