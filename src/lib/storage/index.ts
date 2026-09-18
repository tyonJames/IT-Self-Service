import { env } from "@/lib/config/env";
import { AzureBlobStorageProvider } from "./azure-blob";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";

export * from "./provider";

const globalForStorage = globalThis as unknown as { __radxStorage?: StorageProvider };

export function storage(): StorageProvider {
  if (globalForStorage.__radxStorage) return globalForStorage.__radxStorage;

  const e = env();
  const provider: StorageProvider =
    e.STORAGE_PROVIDER === "azure"
      ? new AzureBlobStorageProvider({
          account: e.AZURE_STORAGE_ACCOUNT,
          containerName: e.AZURE_STORAGE_CONTAINER,
          connectionString: e.AZURE_STORAGE_CONNECTION_STRING || undefined,
        })
      : new LocalStorageProvider(e.STORAGE_LOCAL_ROOT);

  globalForStorage.__radxStorage = provider;
  return provider;
}

/** Test-only: inject a stub provider. */
export function setStorageProvider(provider: StorageProvider | undefined): void {
  globalForStorage.__radxStorage = provider;
}
