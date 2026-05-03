# npm audit residual acceptance (May 2026)

## 1. Summary

- Production/runtime dependency audit is clean.
- Remaining full `npm audit` findings are accepted temporary dev/tooling residuals.
- No dependency PR is recommended right now.

## 2. Completed security fixes

- PR #204: Vite high fixed.
- PR #205: PostCSS moderate fixed.
- PR #206: drizzle-orm runtime high fixed.

## 3. Current dependency state

- node: `20.x`
- npm: `10.8.2`
- vite: `^7.3.2`
- postcss: `^8.5.13`
- drizzle-orm: `^0.45.2`
- direct esbuild: `^0.27.2`
- drizzle-kit: `^0.30.4` in `devDependencies`

## 4. Current audit status

- `npm audit --omit=dev`: 0 vulnerabilities
- full `npm audit`: 4 moderate vulnerabilities
- residual chain:
  - `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild`

## 5. Latest drizzle-kit status

- `npm view drizzle-kit version` returned `0.31.10`
- `drizzle-kit@0.31.10` still depends on `@esbuild-kit/esm-loader`
- upgrading to latest does not remove the full audit residual

## 6. Risk classification

- dev/tooling-only path
- not production runtime path
- direct project esbuild is patched
- advisory relates to dev-server exposure
- no evidence this chain is reachable from the public production e-shop runtime

## 7. Explicit non-actions

- do not run `npm audit fix --force`
- do not add overrides without a separate compatibility probe
- do not run `db:push` or `db:migrate` for this
- do not create a drizzle-kit dependency PR unless full `npm audit` becomes clean without force

## 8. Follow-up policy

- re-check when a newer drizzle-kit version is released
- future PR is acceptable only if `npm audit` becomes clean without force and validation passes
