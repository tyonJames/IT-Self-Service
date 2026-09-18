import { BlobServiceClient, type ContainerClient, RestError } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { StorageObjectNotFoundError, type StorageProvider, type StoredObject } from "./provider";

/**
 * Azure Blob Storage provider.
 *
 * Authentication prefers Managed Identity (instruction §9): when only the
 * account name is configured, `DefaultAzureCredential` picks up the App
 * Service's system-assigned identity, so no storage key exists to leak. A
 * connection string is still accepted for local testing against Azurite or a
 * development storage account.
 *
 * The container is created private; no public access level is ever set, and no
 * SAS URL is ever generated — downloads always go through the authenticated
 * route handler.
 */
export class AzureBlobStorageProvider implements StorageProvider {
  readonly name = "azure";

  private container: ContainerClient | null = null;

  constructor(
    private readonly options: {
      account: string;
      containerName: string;
      connectionString?: string;
    },
  ) {}

  private client(): ContainerClient {
    if (this.container) return this.container;

    const service = this.options.connectionString
      ? BlobServiceClient.fromConnectionString(this.options.connectionString)
      : new BlobServiceClient(
          `https://${this.options.account}.blob.core.windows.net`,
          new DefaultAzureCredential(),
        );

    this.container = service.getContainerClient(this.options.containerName);
    return this.container;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    const blob = this.client().getBlockBlobClient(key);
    await blob.uploadData(bytes, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        // Belt and braces: even if a blob URL were ever exposed, the browser
        // would download it rather than render it in our origin.
        blobContentDisposition: "attachment",
      },
    });
    return { key, size: bytes.length, contentType };
  }

  async get(key: string): Promise<Buffer> {
    try {
      const blob = this.client().getBlockBlobClient(key);
      return await blob.downloadToBuffer();
    } catch (error) {
      if (error instanceof RestError && (error.statusCode === 404 || error.statusCode === 403)) {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client().getBlockBlobClient(key).deleteIfExists();
  }

  async exists(key: string): Promise<boolean> {
    return this.client().getBlockBlobClient(key).exists();
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client().getProperties();
      return true;
    } catch {
      return false;
    }
  }
}
