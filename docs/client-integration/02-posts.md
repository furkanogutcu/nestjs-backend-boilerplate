# Posts

The example domain module. It exists to show how a feature is built in this codebase — public reads, owner-only
writes, pagination, search, caching, idempotent creation, signed uploads and a moderation route — so a new
module can be written by following it rather than by reading the architecture guide twice.

Delete `src/modules/posts` and this document when you start your own domain; nothing else depends on them.

## Endpoints

| Method   | Path                          | Auth             | Notes                                     |
| -------- | ----------------------------- | ---------------- | ----------------------------------------- |
| `GET`    | `/posts`                      | public           | Published posts, paginated and searchable |
| `GET`    | `/posts/:slug`                | public           | A single published post (cached)          |
| `GET`    | `/me/posts`                   | bearer           | The caller's posts, drafts included       |
| `POST`   | `/posts`                      | bearer           | Creates a draft; idempotent               |
| `PATCH`  | `/posts/:postId`              | bearer           | Author only                               |
| `POST`   | `/posts/:postId/publication`  | bearer           | Author only; makes the draft public       |
| `POST`   | `/posts/:postId/cover-upload` | bearer           | Returns a signed upload URL               |
| `DELETE` | `/posts/:postId`              | bearer           | Author only                               |
| `DELETE` | `/admin/posts/:postId`        | `posts:moderate` | Any post; recorded in the audit log       |

## Listing and search

`GET /posts?page=1&page_size=20&q=hello` returns the offset-paginated envelope described in
[00-overview.md](./00-overview.md). `q` matches the title and the slug.

## Creating a draft

Send an `Idempotency-Key` header. Retrying the same request with the same key returns the first result instead
of creating a second post — the retry a flaky mobile network causes is not a duplicate.

```http
POST /api/v1/posts
Authorization: Bearer <access token>
Idempotency-Key: 5f3c9a1e7b2d4c8a9e0f1b2c
Content-Type: application/json

{ "slug": "hello-world", "title": "Hello world", "body": "The first paragraph…" }
```

A new post is always a draft: `published_at` is `null` and only its author can read it.

## Publishing

`POST /posts/:postId/publication` stamps `published_at`. From then on the post is readable by anyone at
`GET /posts/:slug`, and the response is cached for a couple of minutes.

## Cover images

The server never handles image bytes. Ask for a signed URL and upload straight to storage:

```http
POST /api/v1/posts/:postId/cover-upload
→ { "url": "https://…", "key": "public/posts/…/cover", "expires_in_seconds": 300,
    "required_headers": { "Content-Type": "image/png", "Content-Length": "20481" } }
```

Then `PUT` the file to `url` with that `Content-Type`. The content type and length are part of the signature,
so a different type or a larger body is rejected by the storage provider. Browsers set `Content-Length`
themselves and reject an explicit one — send only `Content-Type` from a browser.

Allowed types are PNG, JPEG and WebP, up to 2 MiB.

## Errors

| Situation                             | Status | Code                       |
| ------------------------------------- | ------ | -------------------------- |
| Slug already taken                    | 409    | `conflict`                 |
| Editing someone else's **draft**      | 404    | `resource_not_found`       |
| Editing someone else's published post | 403    | `insufficient_permissions` |
| Publishing twice                      | 409    | `conflict`                 |
| Moderating without `posts:moderate`   | 403    | `insufficient_permissions` |

The 404 on someone else's draft is deliberate: telling a stranger that a draft exists is itself a disclosure.
