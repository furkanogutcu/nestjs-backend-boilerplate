# Object storage

The application never handles file bytes: it signs a URL and the client uploads straight to the bucket. This
runbook covers provisioning that bucket and the one policy the code assumes.

## What the code assumes

| Assumption                                                                 | Why                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| One bucket holds both the `public/` and `private/` key prefixes            | The prefix, not the bucket, decides visibility                     |
| Objects under `public/*` are readable without a signature                  | `publicUrl()` returns `S3_PUBLIC_BASE_URL/<key>` and signs nothing |
| Everything else is private                                                 | Reads go through a short-lived signed URL                          |
| The credentials can `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` | Upload, download, existence check, cleanup                         |

## Cloudflare R2

1. Create the bucket. Note the account id — the endpoint is
   `https://<account-id>.r2.cloudflarestorage.com`.
2. Create an **API token** scoped to that bucket with read+write. Set `S3_ACCESS_KEY_ID` and
   `S3_SECRET_ACCESS_KEY` from it.
3. Expose the public prefix. Either connect a custom domain to the bucket and put a Cache Rule / Worker in
   front that only serves paths starting with `public/`, or keep the bucket entirely private and drop
   `S3_PUBLIC_BASE_URL` — then every read is a signed URL.
4. `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`.

## AWS S3

1. Create the bucket with **Block Public Access on**.
2. Attach a bucket policy that opens only the public prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForPublicPrefix",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<bucket>/public/*"
    }
  ]
}
```

3. Serve it through CloudFront and set `S3_PUBLIC_BASE_URL` to the distribution domain.
4. `S3_REGION` must be the real region; `S3_FORCE_PATH_STYLE=false`.

## MinIO (local development)

`docker-compose.development.yml` already starts MinIO on `:9000` (console `:9001`,
`minioadmin`/`minioadmin`). Create the bucket once from the console, then:

```
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=<name>
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

`S3_PUBLIC_BASE_URL` can stay empty locally; anything that needs a public URL will fail loudly instead of
silently producing a broken link.

## Verifying

```bash
# should return a signed URL
curl -s -X POST "$API/posts/<postId>/cover-upload" -H "Authorization: Bearer $TOKEN"

# uploading with a different content type than was signed must fail
curl -X PUT "<signed url>" -H 'Content-Type: application/pdf' --data-binary @file.png
```

The second command failing is the guarantee working: the content type and length are part of the signature.

## Rotating credentials

Issue a new key pair, deploy with the new `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, confirm an upload
succeeds, then revoke the old pair. Signed URLs already handed out remain valid until they expire
(`UPLOAD_URL_TTL_SECONDS`, at most an hour), so wait that long before revoking if you need zero failures.
