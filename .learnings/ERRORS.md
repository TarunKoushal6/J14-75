
## [ERR-20260519-001] vercel_node_function_builder

**Logged**: 2026-05-19T04:57:00Z
**Priority**: high
**Status**: pending
**Area**: infra

### Summary
Vercel production deploy repeatedly failed after adding Circle App Kit adapter packages; frontend build passed, failure occurred during Node/serverless function packaging.

### Error
```text
Error: Cannot convert object to primitive value
```

### Context
- Project: J14-75
- Vercel project: j14-75
- API wrapper moved to bundled `artifacts/api-server/dist/index.cjs`, but API bundle still externalized Circle/AppKit/viem packages because `artifacts/api-server/build.ts` allowlist did not include them.
- Vercel's function builder likely hit package tracing/runtime metadata issue on externalized deps.

### Suggested Fix
Bundle Circle/AppKit/viem deps into API `dist/index.cjs` via esbuild allowlist so Vercel traces a simple bundled function rather than raw package trees.

### Metadata
- Reproducible: yes
- Related Files: artifacts/api-server/build.ts, api/index.js, vercel.json
- See Also: Vercel deploy attempts around commits 5d94289, 53e2376, 62ec024, 6012f63

---
