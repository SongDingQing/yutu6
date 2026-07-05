# V3 独立素材提示词模板

所有提示词必须包含:

- Use the V3 reference style: refined high-density isometric pixel art, dark console palette, clean edges, consistent light.
- Independent asset only, transparent/chroma-key removable background, generous padding, no crop.
- Exact footprint and source canvas from `grid-spec.json`.
- Same isometric angle and scale as the V3 reference.
- No text, no labels, no watermark, no emoji.

## 通用负面约束

Avoid: full-scene illustration, merged room, perspective mismatch, missing tile corners, cropped edges, fuzzy upscale, white fringe, detached chair, reversed monitor, floating props, huge chibi head, rough low-density pixels, cast shadow on background.

## floor-carpet-1x1

Create one independent 1x1 isometric thick carpet floor tile. Source canvas 128x96. Footprint diamond 128x64 with 14px visible side thickness, dark charcoal carpet top, subtle grid seam, teal-blue console accent only on edge, clean pixel edges, transparent/chroma-key removable background.

## workstation-empty-2x2

Create one independent 2x2 isometric office workstation module. Source canvas 256x192. A complete 2x2 floor footprint with attached desk, matching chair, monitor, keyboard, small tower and divider. Monitor faces the seated user direction correctly, not mirrored. Chair and desk scale consistent. No person baked in.

## chairman-desk-2x3

Create one independent chairman executive desk module. Source canvas 256x256. Footprint 2x3. Large dark wood executive desk, high-back leather chair tucked behind it, multi-monitor computer, desk lamp, papers, cyan accent light. No person baked in. Fits inside a 5x5 office grid.

## plant-1x1

Create one independent 1x1 potted green plant prop. Source canvas 128x96. Isometric pot, refined pixels, dark office palette, clean transparent/chroma-key removable background.

## character-secretary-working

Create one independent seated secretary typing sprite source. Source canvas <=256x256. Human-like refined Q-version office staff, professional outfit, seated at invisible desk height, hands on keyboard, palms/wrists stable, only fingers implied moving. Smaller head ratio than old chibi. Transparent/chroma-key removable background.
