import { StorageVisibility } from './enums/storage-visibility.enum';

// ! The bucket policy grants public read on this prefix — changing these strings changes what is publicly reachable.
export const STORAGE_PREFIXES: Record<StorageVisibility, string> = {
  [StorageVisibility.Public]: 'public',
  [StorageVisibility.Private]: 'private',
};
