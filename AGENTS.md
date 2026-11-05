# Web app design rules

After changes, run `pnpm lint`, `pnpm format:check`, `pnpm test`, and the relevant browser tests. Fix every error and warning.

- Keep the square monochrome editorial theme. Use Lora for headings and strong labels, and Source Sans 3 for supporting text and controls. Use heavy section rules and fine dividers. Control spacing uses a 4px scale; page sections and columns use the fluid `--section-space` and `--column-space` tokens.
- Components in `components/ui` own their appearance. Callers may place them with layout utilities; use explicit variants for padding, dimensions, typography, and colors. Normal controls are 36px high and table rows 44px.
- Use semantic theme colors. Raw color values belong only in theme definitions or user ink data. Do not add global element selectors to restyle controls.
- All six shadcn rules are errors. Only `no-restyle` and `require-static-classes` are disabled within UI implementations so variant factories can work. Never disable a rule to silence a caller.
- Runtime timeline geometry, virtual row spacers, and progress use typed CSS custom properties. User ink swatches remain native color inputs. No blanket inline-style exceptions.
- Keep specialized geometry and scrollbar CSS scoped. Stylelint forbids duplicate selectors/declarations and `!important`. Do not append override blocks.
- Panel form state stays local. The workspace context coordinates project state; project persistence and optimizer lifecycle live in separate hooks. Preserve JSON v1, the IndexedDB key, CSV formats, and WASM interfaces.

- New projects use `snapshot.transition_times` in hours. Multi-ink cleaning minimizes the maximum matched transition time after retaining unchanged inks; setup and the cleaning objective use that same duration. Minutes/Hours is a display conversion. Legacy snapshots without this field remain supported by the worker.
