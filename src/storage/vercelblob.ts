import { IStorageService } from "./storage";

// Vercel Blob Storage Service
export class VercelBlobStorage implements IStorageService {
  private BLOB_READ_WRITE_TOKEN: string;

  constructor(blobReadWriteToken: string) {
    if (!blobReadWriteToken) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is required for VercelBlobStorage"
      );
    }
    this.BLOB_READ_WRITE_TOKEN = blobReadWriteToken;
  }

  async uploadFile(filename: string, buffer: Buffer): Promise<string> {
    const { put } = await import("@vercel/blob");
    const blob = await put(filename, buffer, { access: "public" });
    return blob.url;
  }
}
