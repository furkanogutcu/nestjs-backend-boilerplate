import { StorageVisibility } from './enums/storage-visibility.enum';

// ! Objects are separated by key prefix, not by bucket, so the bucket policy that exposes `public/*` is the
// ! single place public readability is decided. Changing these strings changes what is publicly reachable.
export const STORAGE_PREFIXES: Record<StorageVisibility, string> = {
  [StorageVisibility.Public]: 'public',
  [StorageVisibility.Private]: 'private',
};
