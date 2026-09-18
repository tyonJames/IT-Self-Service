/**
 * Storage abstraction (instruction §9).
 *
 * Uploaded files are never served from a public URL. The application reads
 * bytes through this interface and streams them out of an authenticated route
 * handler, so a blob URL never reaches the browser and permissions are checked
 * on every single download.
 */

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Liveness probe for /api/health. */
  healthy(): Promise<boolean>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Stored object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}
