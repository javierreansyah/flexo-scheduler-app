<div align="center">
  <img src="apps/web/app/icon.svg" width="100" alt="Flexo Scheduler icon" />
  <h1>Flexo Scheduler</h1>
  <p>Shape your production schedule, right in your browser.</p>
</div>

Flexo Scheduler helps plan flexographic production across machines, jobs, and
color changes. Set up your equipment, add orders, and find a schedule with a
simulated annealing optimizer running entirely on your device. No account,
optimization API, or server-side job processing is required.

## ✨ Features

- **Set up production quickly:** Edit machines and jobs in spreadsheet-style
  tables, paste rows, and import or export CSV data.
- **Define your colors:** Create a named color palette, edit directed transition
  costs in a matrix, and configure setup-duration overrides.
- **Choose your compute budget:** Use Quick, Balanced, or Thorough presets, or
  adjust the optimizer parameters yourself.
- **See the schedule:** Explore the production timeline, shift views, schedule
  details, objective metrics, and optimization progress.
- **Handle new arrivals:** Advance the current horizon, retain started work, and
  reschedule remaining jobs alongside new orders. Review previous horizons.
- **Try realistic inputs:** Load the original industry example or generate jobs
  and machines. Generated jobs sample industry quantities and ink patterns,
  mapped onto your current palette.
- **Keep work local:** WebAssembly workers perform optimization off the main
  thread. Projects autosave in browser storage and can be backed up as JSON.
- **Work comfortably:** A responsive dark interface with fluid typography,
  square controls, and an animated grid background.

## 🚀 Get started

You'll need **Node.js 22+**, **Python 3**, Git, and
[pnpm](https://pnpm.io/). The repository pins pnpm 10.33.2 in `package.json`.
The first WebAssembly setup downloads and activates Emscripten SDK 6.0.13.

1. Install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Set up the WebAssembly toolchain:

   ```sh
   pnpm wasm:setup
   ```

3. Start the development server:

   ```sh
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The development command builds the optimizer before starting Next.js. No API
keys or environment variables are needed for the scheduling app.

For a production export and local Cloudflare preview:

```sh
pnpm build
pnpm preview
```

## Using the scheduler

Start with the industry example, or define your own machines, colors, and jobs.
Color inputs accept comma-separated names, including repeated inks. Matrix rows
are source colors and columns are replacement colors; ink costs and setup hours
are separate settings. The industry example uses placeholder color names because
the source data identifies ink IDs and darkness ordering rather than actual hues.

Machine, palette, and changeover settings freeze after the first accepted
schedule. Advance the arrival time before adding another batch; jobs whose setup
has started remain locked. Times use production hours and consecutive eight-hour
shifts. Export project JSON for a backup: clearing browser storage removes local
projects.

Presets were calibrated on 10/30/50/100 movable jobs with the original three
machines and default changeovers. Other inputs are supported, but measured
average quality gaps are not guarantees for every schedule. Native tuning results
also need browser-specific runtime checks before adoption.

## 🛠️ Built with

- [Next.js](https://nextjs.org/), [React](https://react.dev/), and TypeScript
- [Tailwind CSS](https://tailwindcss.com/) and [shadcn/ui](https://ui.shadcn.com/)
- [TanStack Table](https://tanstack.com/table) and TanStack Virtual
- C++ simulated annealing, [Emscripten](https://emscripten.org/), WebAssembly,
  and Web Workers
- Python and [SMAC](https://github.com/automl/SMAC3) for offline parameter tuning
- [Cloudflare Pages](https://pages.cloudflare.com/) for static hosting

## Project structure

| Directory | Purpose |
| --- | --- |
| `apps/web` | Static Next.js app, editable tables, local persistence, and timeline |
| `packages/optimizer` | Native Python/C++ optimizer, datasets, tuning, and experiments |
| `packages/optimizer-wasm` | Browser bindings and optimization workers sharing the C++ engine |
| `scripts` | WebAssembly setup, builds, profile export, and browser benchmarks |
| `docs` | Browser verification notes |

For offline experiments, see the [optimizer guide](packages/optimizer/README.md)
and [playground guide](packages/optimizer/experiments/README.md). The
[tuning guide](packages/optimizer/docs/tuning.md) describes fixed-budget searches,
exact-result caching, checkpoints, and terminal progress. The latest
[results report](packages/optimizer/docs/pareto-tuning-report.md) includes the
paused campaign's completed searches and comparison charts.

Local result caches, generated SMAC instances, toolchains, and build outputs are
Git-ignored; they are not bundled with the repository. The reports retain numeric
snapshots of analyzed results.

## ✅ Development checks

```sh
pnpm lint
pnpm test
pnpm build
pnpm --filter @flexo/web exec playwright install chromium firefox webkit
pnpm test:e2e
```

Build the static export before running browser tests. For the native optimizer,
run these from `packages/optimizer` with a C++17 compiler installed:

```sh
python -m pip install -e ".[tuning,test,experiments]"
python -m pytest -q
```

See [browser verification](docs/browser-app-verification.md) for native/browser
comparisons. After building, `pnpm benchmark:browser` runs the representative
browser benchmark.

## Deploy to Cloudflare Pages

Use the repository root as the project directory:

| Setting | Value |
| --- | --- |
| Build command | `pnpm wasm:setup && pnpm build` |
| Output directory | `apps/web/out` |
| Node.js | 22+ |

Enable pnpm and allow toolchain downloads during the build. The app exports
static files; no Pages Functions or runtime API are required. Building regenerates
browser presets from `packages/optimizer/flexo/profiles.json`, so review those
profiles before deploying.

## 📄 License

Flexo Scheduler is available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

The visual language and grid background draw from
[Javier Reansyah's portfolio](https://github.com/javierreansyah).
The optimizer uses SMAC for offline tuning and Emscripten to bring its shared
native scheduling engine into the browser.
