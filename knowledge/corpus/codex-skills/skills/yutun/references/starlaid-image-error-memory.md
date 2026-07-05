# Starlaid 玉豚 Image Error Memory

Use this file when Starlaid image generation, cleanup, procedural art, or Unity asset integration has a prior user correction or a likely repeat failure. Read it before retrying rejected Starlaid art and before changing terrain masks/autotiles.

## Update Rule

For each durable lesson, add a dated entry with:

- Failure signal: the user's correction or observed problem.
- Scope: Starlaid asset families affected.
- Avoid: specific visual or workflow mistakes.
- Required fix: concrete generation/integration rules.
- Validation: the checks future agents should run before calling the issue solved.

## Entries

### 2026-05-09 - Conveyor quality must come from high-detail source art

Failure signal: The user rejected a conveyor repair because the style matched the command-core direction only superficially, while the processed in-game tile became low-detail and procedural-looking; they also rejected uneven belt cells because future animation would look jittery.

Scope: Starlaid conveyors, roads/routes, building docking ports, route masks, animation-ready belt cores, and future upgrade-tier route machinery.

Avoid: Drawing final conveyors from flat local shapes/noise; letting a script overwrite image-generation detail; uneven belt plate widths or inconsistent animation phase; checkerboard-background source images treated as transparency; dark UI-like route modules that do not match the command core's semi-realistic cream/charcoal/orange/cyan colony kit.

Required fix: Generate or image-edit a high-detail conveyor source in the accepted command-core/turret style first, then use scripts only to crop, remove background, assemble N/E/S/W route masks, align seamless endpoints, and gently enforce equal belt module phase. All conveyor tiers must share endpoint sleeve geometry so low/high-tier belts can connect. If equal-spacing correction visibly lowers detail, regenerate or image-edit instead of accepting a procedural replacement.

Validation: Compare the final runtime sprites and seam preview against `building_command_core.png` and `building_basic_turret.png` at close zoom. Check adjacent straight tiles have no gutter, belt modules are equal-width/in-phase, building-facing endpoints are not abrupt, and the asset still reads as high-detail Starlaid colony machinery rather than a scripted mockup.

### 2026-05-09 - Shoreline masks are connectivity, not visible geometry

Failure signal: The user said the mask concept was good, but the masks being circular made the terrain look ugly when tiled; they wanted a more natural result, including many random replaceable variants, with detail closer to the command core's visual density.

Scope: Starlaid terrain water-edge, grass-shore, sand-shore, biome transition, route-edge, and future autotile/mask systems.

Avoid: Perfect circular, capsule, or rectangular visible shore shapes; treating `rounded_side_mask` output as final art; hard grass-water seams; too few variants; low-resolution masks that look sparse compared with main buildings; changing N/E/S/W IDs in a way that breaks connectivity semantics.

Required fix: Preserve the mask/state IDs as connectivity rules, but make the visible terrain boundary organic and irregular. Water should own the strong silhouette; grass should carry a softer low-contrast wet bank; non-water sides should visually return to the base ground tile. Add grass, stone, mud, foam, and color micro-variation where appropriate. Use high enough source resolution for close inspection, and provide multiple stable variants for natural-edge tiles so repeated terrain does not reveal a stamped pattern.

Validation: Generate a variant contact sheet plus an in-context mini-field preview, inspect both close zoom and gameplay zoom, and compare detail density against Starlaid command-core/turret reference assets. For procedural changes, at minimum run the generator syntax check and the Starlaid health/asset audit workflow; run the automated tests when gameplay/rendering contracts change.
