import fs from "node:fs/promises";
import path from "node:path";
import { StorageObjectNotFoundError, type StorageProvider, type StoredObject } from "./provider";

/**
 * Filesystem storage for development and single-instance deployments.
 *
 * The root is resolved once and every key is re-resolved against it: a key
 * containing `..` cannot escape, even though keys are generated server-side
 * and never come from the client.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Refusing to access a storage path outside the storage root.");
    }
    return target;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { mode: 0o600 });
    return { key, size: bytes.length, contentType };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}
