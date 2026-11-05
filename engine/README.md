# Browser optimizer

This directory contains only the scheduling app's engine: three C++ headers in
`src`, Emscripten bindings, worker validation, and changeover calculations.
The source was copied unchanged from the native research project at checkpoint
`8cae5fe`; future engine changes must be reviewed and tested here independently.

`pnpm wasm:build` compiles the engine with Emscripten 6.0.13 and bundles the worker.
Generated files go to `dist` and content-addressed `public/optimizer` assets.
`lib/engine-manifest.json` records their version and the preset data hash.
`lib/profiles.json` contains the calibrated fixed-budget presets; building never
rewrites them. `e2e/native-fixtures.json` retains the native parity references.

Python bindings, training datasets, SMAC, benchmark variants, and tuning reports
belong to the separate research project and are unnecessary to build this app.
