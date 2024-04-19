# [1.0.0](https://github.com/kapetacom/nodejs-api-client/compare/v0.2.0...v1.0.0) (2024-04-19)


### Features

* migrate to fetch API for requests [CORE-2607] ([#10](https://github.com/kapetacom/nodejs-api-client/issues/10)) ([abe0157](https://github.com/kapetacom/nodejs-api-client/commit/abe01576f41d154620b1d3e30c100e963ab30c59))


### BREAKING CHANGES

* significantly changes the underlying request library,
to a point where it will probably cause issues in some cases.
Direct use of the send API might hit incompatiblities.

# [0.2.0](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.6...v0.2.0) (2024-01-09)


### Features

* Auto-refresh token if we get a token expired error ([#9](https://github.com/kapetacom/nodejs-api-client/issues/9)) ([812014b](https://github.com/kapetacom/nodejs-api-client/commit/812014b0557c40c820f3060d40630a353ac7c93a))

## [0.1.6](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.5...v0.1.6) (2023-11-16)


### Bug Fixes

* handle non-JSON in error responses ([#8](https://github.com/kapetacom/nodejs-api-client/issues/8)) ([4a198ea](https://github.com/kapetacom/nodejs-api-client/commit/4a198ea7305f5bdc020e3f31c13875257a944120))

## [0.1.5](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.4...v0.1.5) (2023-10-21)


### Bug Fixes

* Preserve refresh token and improve error messages ([#6](https://github.com/kapetacom/nodejs-api-client/issues/6)) ([7967029](https://github.com/kapetacom/nodejs-api-client/commit/79670293bfd5bdfc70d19c2a7b19e717c9d0c1c6))

## [0.1.4](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.3...v0.1.4) (2023-10-04)


### Bug Fixes

* Gracefully handle invalid credentials in env ([#5](https://github.com/kapetacom/nodejs-api-client/issues/5)) ([9f56b77](https://github.com/kapetacom/nodejs-api-client/commit/9f56b770467eb8f59e9007d26a689431bc1f9d1f))

## [0.1.3](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.2...v0.1.3) (2023-09-26)


### Bug Fixes

* treat bad tokens in auth file as token not found ([#4](https://github.com/kapetacom/nodejs-api-client/issues/4)) ([42b1c9c](https://github.com/kapetacom/nodejs-api-client/commit/42b1c9cf7f1564c50c583642d794ba2127f83a4d))

## [0.1.2](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.1...v0.1.2) (2023-07-22)


### Bug Fixes

* Added types to API methods ([eb23168](https://github.com/kapetacom/nodejs-api-client/commit/eb231685def27748caced08536ff3d558be2a79f))

## [0.1.1](https://github.com/kapetacom/nodejs-api-client/compare/v0.1.0...v0.1.1) (2023-07-22)


### Bug Fixes

* Use specific npm ignore file ([7aea77f](https://github.com/kapetacom/nodejs-api-client/commit/7aea77ff32bbb26d307e11dc0cadccb18baff7a1))

# [0.1.0](https://github.com/kapetacom/nodejs-api-client/compare/v0.0.13...v0.1.0) (2023-07-22)


### Features

* Rewrite to Typescript and adds general purpose send method ([#3](https://github.com/kapetacom/nodejs-api-client/issues/3)) ([3da4e9f](https://github.com/kapetacom/nodejs-api-client/commit/3da4e9f22aea5b0e715f6386f7ccb2d8aa07c17f))
