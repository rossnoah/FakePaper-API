// Interface for Storage Service
export interface IStorageService {
  uploadFile(filename: string, buffer: Buffer): Promise<string>;
}
