import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';

const TMP_AUTH_DIR = '/tmp/auth';

/**
 * Downloads all auth files from S3 into /tmp/auth, then wraps Baileys
 * useMultiFileAuthState on that directory. On creds.update, changed files
 * are uploaded back to S3.
 *
 * The S3 bucket is configured with SSE-KMS default encryption, so all
 * objects are encrypted at rest automatically — no client-side crypto needed.
 */
export async function useS3AuthState(bucket: string, prefix = 'auth/') {
  const s3 = new S3Client({});

  // Ensure clean temp directory
  fs.rmSync(TMP_AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_AUTH_DIR, { recursive: true });

  // Download all auth files from S3 to /tmp/auth
  const listResult = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );

  if (listResult.Contents) {
    for (const obj of listResult.Contents) {
      if (!obj.Key) continue;
      const fileName = obj.Key.slice(prefix.length);
      if (!fileName) continue;

      const getResult = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: obj.Key }),
      );

      if (getResult.Body) {
        const data = await getResult.Body.transformToString();
        fs.writeFileSync(path.join(TMP_AUTH_DIR, fileName), data, 'utf-8');
      }
    }
    console.log(`[s3auth] Downloaded ${listResult.Contents.length} auth files from S3`);
  } else {
    console.log('[s3auth] No existing auth files in S3');
  }

  // Use Baileys' built-in multi-file auth on the temp directory
  const { state, saveCreds: originalSaveCreds } = await useMultiFileAuthState(TMP_AUTH_DIR);

  // Wrap saveCreds to also upload changed files back to S3
  const saveCreds = async () => {
    await originalSaveCreds();
    await uploadAuthDir(s3, bucket, prefix);
  };

  return { state, saveCreds };
}

async function uploadAuthDir(s3: S3Client, bucket: string, prefix: string) {
  const files = fs.readdirSync(TMP_AUTH_DIR);
  for (const file of files) {
    const filePath = path.join(TMP_AUTH_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}${file}`,
        Body: content,
        ContentType: 'application/json',
        // SSE-KMS is enforced by bucket default encryption — explicit header
        // ensures the request works even if the bucket policy requires it
        ServerSideEncryption: 'aws:kms',
      }),
    );
  }
  console.log(`[s3auth] Uploaded ${files.length} auth files to S3`);
}

/**
 * Upload a local auth directory to S3 (used by bootstrap script).
 */
export async function uploadLocalAuthToS3(
  localAuthDir: string,
  bucket: string,
  prefix = 'auth/',
) {
  const s3 = new S3Client({});
  const files = fs.readdirSync(localAuthDir);

  for (const file of files) {
    const filePath = path.join(localAuthDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}${file}`,
        Body: content,
        ContentType: 'application/json',
        ServerSideEncryption: 'aws:kms',
      }),
    );
  }

  console.log(`[s3auth] Uploaded ${files.length} auth files from ${localAuthDir} to s3://${bucket}/${prefix}`);
}
