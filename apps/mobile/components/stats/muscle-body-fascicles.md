# Fascicle companion asset

Load when changing or consuming the fascicle geometry. The native Progress 3D
body consumes this schematic asset for selected-muscle relief fibres.

Regenerate from the repository root:

```sh
node apps/mobile/scripts/generate-muscle-body-fascicles.cjs
node apps/mobile/scripts/generate-muscle-body-fascicles.cjs --check
```

The generator's portable inputs are `muscle-body-mesh.json`, the procedural
fields/landmarks in the generator, and
`../../scripts/muscle-body-fascicles-source.json`. Literature informs qualitative
directions and architecture; no published figures, measured 3D coordinates or
third-party geometry are copied. Source links do not license those publications
for redistribution. The companion inherits the reference mesh's provenance; it
does not establish additional rights to that mesh.

## Version 1 contract

- `referenceMesh.sha256` hashes the **exact bytes** of the adjacent body JSON.
  Any mesh edit, including reordered faces or serialization changes, requires
  regeneration. The offline validator rejects a mismatch.
- `muscles` is keyed by the 25 reference muscle IDs. Reporting assignments stay
  with the existing report machinery ([[muscle.report-groups]]); this asset has
  no report groups, user settings or colors.
- Each `segments` item contains one `face` index and two barycentric triples,
  `a` and `b`, in that face's vertex order. Reconstruct a point as
  `w0 * vertex0 + w1 * vertex1 + w2 * vertex2`. Every stored line lies in one
  triangle; no surface offset is baked in.
- **Render segments independently.** `path` identifies a procedural guide,
  not a continuous biological fascicle. Never join endpoints across missing,
  occluded or discontinuous surface patches. The selected relief overlay
  intentionally bypasses body-depth occlusion and back-face culling; only its
  highlight pass has a small display offset. Base anatomy retains its visibility.
- `side` is the mesh x-coordinate sign, not a clinical left/right label.
  `layer: deep-projection` means a projected schematic, not an internal volume.
- Pectoral `part` distinguishes clavicular, sternocostal and minor; `kind`
  distinguishes fascicle guides from insertion marks. Their projected landmark
  geometry intentionally extends beyond some old chest material labels.
- Pectoralis minor is declared under chest `extensions`: no new catalog entry,
  no measured BoGa volume. The model’s on-demand Information sheet explains its projected depth.

`quality`, each entry's sources and limitations are part of the asset. Limb
groups aggregate several muscles; most internal aponeuroses, deep volumes and
individual pennation angles remain unregistered. Rectus tendon positions and
pectoral insertion bands are illustrative. Geometry checks prove surface binding
and reproducibility, not anatomical validity. The offline validation code stays
under `../../scripts/validate-muscle-body-fascicles.cjs`; its Node dependencies
must not be imported into the mobile renderer.
