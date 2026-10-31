# Flexo scheduling workspace

A browser-only production scheduler. Next.js exports static HTML; the C++ simulated annealing optimizer runs in WASM Web Workers. No optimization API or account is required.

## Run locally

Requires Node.js 22+, pnpm 10.33.2, Python 3 and Git. First-time WASM setup downloads the pinned Emscripten SDK (6.0.13).

```powershell
pnpm install
pnpm wasm:setup
pnpm dev
```

Open http://localhost:3000. For the production export:

```powershell
pnpm build
pnpm preview
```

## Workspace

- `apps/web`: static Next.js app, editable TanStack tables, original portfolio grid, project persistence and timeline.
- `packages/optimizer`: original Python/C++ project, experiments, datasets and saved results. Run Python commands from this directory; the experiment runner still works with Run Python File in Terminal.
- `packages/optimizer-wasm`: thin WASM bindings and off-thread snapshot preparation. Search and scoring share the native C++ implementation.

Machine/changeover settings freeze after the first accepted schedule. Advance the arrival time before adding the next batch; jobs whose setup has started are locked. Previous horizons remain viewable. Export project JSON to back up local work. Clearing browser storage removes autosaved data.

Quick/Balanced/Thorough use the completed tuning results. Quick shares Balanced for N30 to preserve cost ordering. Larger job counts and custom equipment/changeovers work, but presets were calibrated only on 10/30/50/100 movable jobs with the original three machines and default changeovers.

Times are production hours with consecutive eight-hour shifts. Duration overrides are directed transitions between sorted ink patterns (`empty` for no inks), independent of the ink-cost matrix. Unspecified transitions retain the legacy setup behavior.

## Checks

```powershell
pnpm lint
pnpm test
pnpm --filter @flexo/web exec playwright install chromium firefox webkit
pnpm --filter @flexo/web test:e2e
cd packages/optimizer
python setup.py build_ext --inplace
python -m pytest -q
```

Build the static export before running browser tests. Python dependencies remain in the optimizer package's setup.py extras.

## Cloudflare Pages

Root directory: repository root. Build command: `pnpm wasm:setup && pnpm build`. Output directory: `apps/web/out`. Use Node 22+ and enable pnpm. No Pages Functions, API routes, credentials, or runtime server are required. The SDK is installed in ignored `.toolchains/`; CI must allow downloads from the official Emscripten sources. Deployment is manual; no production site has been published.

The requested shadcn Claude MCP configuration is in `.mcp.json`; restart the client to load it. All UI uses the buFywKm preset with zero radius.

See [browser verification](docs/browser-app-verification.md) for measured timings and native/browser quality differences. Reproduce the five-case comparison with `pnpm benchmark:browser` after building. Previous tuning reports are under `packages/optimizer/docs`.

The Changeovers tab includes a directed ink-cost matrix seeded from the original industry inks. Rows are source inks; columns are replacements. Higher-numbered inks are darker: lighter replacements/removal cost 1, darker replacements/addition cost 0. Common inks are retained before minimum-cost matching. Restore industry defaults resets all cells; custom costs remain fixed after the first schedule. New ink IDs automatically extend the matrix using industry defaults.
