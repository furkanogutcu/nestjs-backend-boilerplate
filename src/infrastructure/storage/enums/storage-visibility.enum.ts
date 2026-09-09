export enum StorageVisibility {
  // * Served straight from S3_PUBLIC_BASE_URL. Only for objects that are safe for anyone holding the URL.
  Public = 'public',
  // * Reachable only through a short-lived signed URL.
  Private = 'private',
}
