# Changelog

All notable changes to this API are documented here. This project follows [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).

# [2.0.0](https://github.com/furkanogutcu/nestjs-backend-boilerplate/compare/v1.0.0...v2.0.0) (2026-09-09)


### Bug Fixes

* run the maintenance clis from dist so they work in the production image ([473a4c5](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/473a4c5d64e33c24997b95d14310ef37b8f1dcab))


### Documentation

* rewrite the guides for the reshaped boilerplate ([23ea905](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/23ea9052def08aea438bfd42b07deab7906fe9dd))


### Features

* **admin:** add user, role and feature-flag management endpoints ([967eb2f](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/967eb2fbe1a5130b3742cc45227daf70c0a521fa))
* **audit:** record identity events in an append-only audit log ([9811f31](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/9811f316782f4eda74e56e53f3bb6943de2d61ea))
* **auth:** add role-based permissions, TOTP mfa and the admin bootstrap cli ([1b91ce0](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/1b91ce09860320fe19f91f6b42a1241c257fa838))
* drain readiness before closing the server on shutdown ([ba8536f](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/ba8536f776b26d5f0d1b9911b1423aef16bf956a))
* **observability:** scrub personal data from spans and guard env sample drift ([ed898fd](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/ed898fd4ea45d738d6062a5c50ce0c62d11b532d))
* **posts:** add the worked example module and enforce response schemas ([138eb8d](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/138eb8dce4abc85331e5f8694331113aff8ac4a4))
* **privacy:** add deferred account erasure and personal data export ([ca32440](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/ca32440fc13cca8c5289b394ab0c8eb0ed41ce67))
* **storage:** add S3-compatible object storage with signed uploads ([b2efb18](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/b2efb18c7c38da56126bc44cf376c1b993f61ff7))


### BREAKING CHANGES

* Kafka, the realtime WebSocket channel, the Prometheus scrape
endpoint and Sentry were removed; TimescaleDB became plain Postgres and Jest
became Vitest. Projects generated from an earlier version cannot upgrade in
place.

# 1.0.0 (2026-07-13)


### Features

* add application bootstrap and root module ([1c339b0](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/1c339b018d747c1903e9d1ddeb93bb46836bab5e))
* **auth:** add authentication module core ([a7f0366](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/a7f0366298329c1556f0ad14a59024534420f70d))
* **auth:** add oauth providers ([59e539c](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/59e539cb94f72dfe092c23d33398f82b1ed26b57))
* **auth:** add password reset flow ([89d0d54](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/89d0d545ee7389dbc8a422076a74ca0145083850))
* **auth:** add user profile endpoints ([866e91b](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/866e91b8015b434e997e209c7f5b315981c3038c))
* **config:** add env schema, samples, app config and keyring ([46d5bad](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/46d5bad3081076b14f643a8e9a41cd71b7155a77))
* **database:** add typeorm data source, naming strategy and migrations ([e446027](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/e446027c14fcbbc2fcc191eb41f9b367a51951ca))
* **infra:** add core infrastructure ([95096ea](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/95096eadbe27ea98d6e5c2d68c1463569105e239))
* **infra:** add kafka messaging with outbox/inbox reliability ([6e7cb04](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/6e7cb04011d4fe2e734694190ed0c860350d21b3))
* **infra:** add mail infrastructure ([51df399](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/51df3994044c74f93aa1ec8ef50d1d429748cd4f))
* **infra:** add rate-limiting, idempotency, queues and sensitive-data handling ([c372f9b](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/c372f9bd13e0c56aed069c1b54dd43ffa2a48c0c))
* **infra:** add realtime websocket infrastructure ([0ed0f22](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/0ed0f2204590ab599b3d9c0f110f28a4d3d3b29a))
* **shared:** add shared building blocks ([3a2feec](https://github.com/furkanogutcu/nestjs-backend-boilerplate/commit/3a2feecf1647ae9a196021467ac9bd11aba8260a))

# Changelog

This file is generated **automatically** by [semantic-release](https://github.com/semantic-release/semantic-release)
after a squash merge to `main` — it is not edited by hand. It stays empty until the first release is published.
