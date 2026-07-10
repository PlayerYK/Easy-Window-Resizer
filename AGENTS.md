# Easy Window Resizer - Agent Notes

## Build and versioning

- `npm run build` is not a read-only compile. It increments `manifest.version` in `src/manifest.json`, rewrites that file, removes and recreates `dist/`, and copies the runtime files into `dist/Easy-window-resizer/`.
- `npm run pack` and `npm run package` invoke `npm run build` first, so they also bump the version and rewrite the build output.
- For source changes, run `npm run build` after the modification so the packaged runtime matches `src/`. Treat the resulting version bump as an intentional change and verify `src/manifest.json` before committing.
- Do not run these commands for read-only syntax, locale, or UI verification. Prefer `node --check src/*.js`, JSON parsing, `git diff --check`, and an isolated preview/test harness.
- Run `npm run pack` or `npm run package` only when a release archive is explicitly requested; both invoke the version-bumping build first.
