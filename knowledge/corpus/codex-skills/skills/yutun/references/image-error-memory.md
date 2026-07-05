# 玉豚 General Image Error Memory

Use this file for image-generation mistakes that apply across projects. If a lesson depends on a specific project's story, art anchors, file IDs, import rules, or gameplay readability, put that project-facing lesson in the matching project memory file as well.

## Update Rule

When a user rejects or corrects generated art, add a dated entry if the failure is likely to recur. Keep entries short and actionable:

- Failure signal: the user's correction, paraphrased in one sentence.
- Scope: where this lesson applies.
- Avoid: the behavior that caused the bad result.
- Corrective rule: what the next generation or procedural pass must do instead.
- Validation: how to check the mistake is gone.

## Entries

### 2026-05-14 - Numeric age prompts do not guarantee character age identity

Failure signal: A Simulaid Tail comic candidate was prompted as 10 years old, but the face still drifted younger than the approved opening-comic Tail; an intermediate candidate was incorrectly treated as usable because it was closer than the previous 6-year-old-looking attempt.

Scope: Story/comic/character art where a character has established age-state references, across projects.

Avoid: Relying on numeric age words alone, accepting “closer than before” as enough, or approving a candidate without comparing it side-by-side to the established same-family age-state reference.

Corrective rule: Convert age into visible identity constraints: face maturity, cheek/jaw/nose proportions, body scale, posture, clothing family, and exact positive reference assets/pages. When a candidate is rejected for age, keep it as a negative example and require the next review to compare positive reference + candidate + negative example before acceptance.

Validation: Make or inspect a compact comparison sheet. The candidate must read as the same age-state and character identity as the approved reference at a glance; if it reads younger/older/generic even with correct body scale, reject it.

### 2026-05-09 - 玉豚 never creates low-quality images

Failure signal: The user clarified that the rule is not conveyor-specific: all images made through 玉豚, across all projects, must come from high-quality generated/image-edited source quality; 玉豚 should never make low-quality images.

Scope: All 玉豚 image generation, regeneration, repair, cleanup, route art, buildings, enemies, items, terrain, and cross-project asset integration.

Avoid: Any low-quality output from 玉豚, including rough procedural drawings, primitive rectangles/circles/strokes, low-detail mockups, weak candidate sheets, poor generated images, checkerboard-background renders presented as transparency, or scripted images called acceptable because they satisfy layout/connectivity.

Corrective rule: Every image 玉豚 creates or replaces must use a real high-quality image-generation or image-editing result as the visual base, optionally guided by user-provided or previously accepted high-quality source art. Local scripts are allowed only for technical operations: crop, alpha cleanup, layer split, pivot alignment, defringe, review sheets, subtle phase/spacing guides, and engine import. If the generated result or post-process is low-quality, reject it and regenerate or image-edit instead of shipping the downgrade.

Validation: Inspect every candidate and final asset at close zoom against the relevant accepted project anchor. Confirm it is high-quality, not visibly lower-detail, not a primitive procedural/mockup image, has no matte/checkerboard artifact, and preserves high-detail material depth after any script processing.

### 2026-05-09 - Connectivity masks must not become visible geometric stamps

Failure signal: The user accepted the mask concept but rejected masks that looked like repeated perfect circles because the composed result felt ugly and unnatural.

Scope: Procedural, composited, or generated image assets that use masks/autotile states/connection rules for terrain, roads, liquids, fog, decals, damage, or similar edge blending.

Avoid: Treating helper masks as the final visible silhouette; relying on clean mathematical circles, capsules, or rectangular strips; shipping one repeated edge shape; using low-detail masks when close inspection is expected.

Corrective rule: Use masks for semantic connectivity and alpha/layout control, then break the visible boundary with asymmetric perturbation, material-detail noise, local color variation, and multiple stable variants. If the surrounding art is detailed, generate or post-process at a detail-compatible resolution rather than stretching simple shapes.

Validation: Preview repeated tiles in a small composed field, inspect both gameplay zoom and close zoom, and compare the edge detail density against a known high-quality anchor asset.
