import { IStorageService } from "./storage";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Buffer } from "buffer";

export class S3StorageService implements IStorageService {
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor() {
    // Fetch region and bucket name from environment variables
    const region = process.env.AWS_REGION;
    const bucketName = process.env.AWS_BUCKET_NAME;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    // Throw an error if any required environment variables are missing
    if (!region || !bucketName || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "Missing required AWS S3 configuration: AWS_REGION, AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID, or AWS_SECRET_ACCESS_KEY."
      );
    }

    // Initialize the S3 client
    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    this.bucketName = bucketName;
    this.region = region;
  }

  async uploadFile(filename: string, buffer: Buffer): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: filename,
        Body: buffer,
      });

      await this.s3Client.send(command);

      // Construct the public URL of the file
      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${filename}`;
      return url;
    } catch (error) {
      throw new Error(
        `Failed to upload file to S3: ${(error as Error).message}`
      );
    }
  }
}
