import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const REGION = process.env.AWS_REGION!
const BUCKET = process.env.AWS_S3_BUCKET!

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

function publicUrlFor(key: string) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encodedKey}`
}

/** Uploads a buffer to S3 and returns its public URL. */
export async function uploadFile(buffer: Buffer, key: string, contentType: string): Promise<string> {
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))
  return publicUrlFor(key)
}

/** Deletes an object from S3. */
export async function deleteFile(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/** Returns a presigned URL for downloading a private object, valid for 1 hour. */
export async function getSignedDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3Client, command, { expiresIn: 3600 })
}

/** Downloads an object's bytes directly (e.g. for MIME-embedding email attachments). */
export async function downloadFile(key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const bytes = await response.Body!.transformToByteArray()
  return Buffer.from(bytes)
}
