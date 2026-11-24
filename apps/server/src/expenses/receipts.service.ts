import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MAX_RECEIPT_BYTES,
  type ReceiptUploadInput,
  type ReceiptUploadResponse,
} from '@twg/shared';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const UPLOAD_TTL_SECONDS = 5 * 60;
const VIEW_TTL_SECONDS = 5 * 60;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Receipt photos live in a private S3 bucket. The browser uploads straight to S3 with a
 * short-lived presigned POST that pins the key, content type and maximum size, and views
 * them through short-lived presigned GET links. The API never proxies the bytes.
 */
@Injectable()
export class ReceiptsService implements OnModuleInit {
  private readonly logger = new Logger(ReceiptsService.name);
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly localEmulator: boolean;
  private readonly appOrigin: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.localEmulator = Boolean(config.receipts?.endpoint);
    this.appOrigin = config.appOrigin;
    if (config.receipts) {
      this.bucket = config.receipts.bucket;
      this.s3 = new S3Client({
        region: config.receipts.region,
        endpoint: config.receipts.endpoint,
        forcePathStyle: Boolean(config.receipts.endpoint),
      });
    }
  }

  /**
   * Local S3 emulator only: create the bucket with the same CORS rule Terraform sets on AWS
   * (POST from the app's origin only), so `pnpm db:up` is all a developer needs.
   */
  async onModuleInit(): Promise<void> {
    if (!this.localEmulator || !this.s3) return;
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
        this.logger.warn(`Couldn't create the local receipts bucket: ${name}`);
        return;
      }
    }
    try {
      await this.s3.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['POST'],
                AllowedOrigins: [this.appOrigin],
                AllowedHeaders: ['*'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      this.logger.warn(`Couldn't set CORS on the local receipts bucket: ${(error as Error).name}`);
    }
  }

  get enabled(): boolean {
    return this.s3 !== undefined;
  }

  async createUpload(groupId: string, input: ReceiptUploadInput): Promise<ReceiptUploadResponse> {
    const { s3, bucket } = this.require();
    const key = `receipts/${groupId}/${randomUUID()}.${EXTENSIONS[input.contentType]}`;
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_RECEIPT_BYTES],
        ['eq', '$Content-Type', input.contentType],
      ],
      Fields: { 'Content-Type': input.contentType },
      Expires: UPLOAD_TTL_SECONDS,
    });
    return { key, url, fields };
  }

  /**
   * Checks a key sent by the client before saving it on an expense: it must be one this API
   * issued for this group (so nobody can attach another group's photo), and it must exist.
   */
  async assertAttachable(groupId: string, key: string): Promise<void> {
    const { s3, bucket } = this.require();
    const pattern = new RegExp(`^receipts/${groupId}/${UUID}\\.(jpg|png|webp)$`);
    if (!pattern.test(key)) {
      throw new BadRequestException('That receipt upload is not valid. Upload the photo again.');
    }
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      throw new BadRequestException('The receipt photo didn’t finish uploading. Try again.');
    }
  }

  async viewUrl(key: string): Promise<string | null> {
    if (!this.s3 || !this.bucket) return null;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: 'inline' }),
      { expiresIn: VIEW_TTL_SECONDS },
    );
  }

  private require(): { s3: S3Client; bucket: string } {
    if (!this.s3 || !this.bucket) {
      throw new ServiceUnavailableException('Receipt photos aren’t available right now');
    }
    return { s3: this.s3, bucket: this.bucket };
  }
}
