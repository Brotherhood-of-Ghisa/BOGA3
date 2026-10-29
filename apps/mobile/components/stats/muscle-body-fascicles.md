# Fascicle companion asset

Load when changing or consuming selected-muscle fibre geometry. The native
Progress body draws these schematic guides; its body mesh remains unchanged.

Regenerate the runtime asset from the repository root:

```sh
node apps/mobile/scripts/generate-muscle-body-fascicles.cjs
node apps/mobile/scripts/generate-muscle-body-fascicles.cjs --check
```

## Geometry contract (version 2)

- `referenceMesh.sha256` hashes the adjacent body JSON's exact bytes. Any
  change requires regeneration; the offline validator rejects a mismatch.
- `muscles` uses the 25 reference IDs. Selection follows
  [[muscle.report-groups]] and [[muscle.untracked]]. The asset has no user
  settings, report groups, statistical assignments or colours.
- Object segments retain triangle-local `face`, barycentric `a`/`b` anchors
  and `layer`. Reconstruct each endpoint as the weighted face vertices. These
  segments keep existing surface behaviour, including the pectoral landmarks.
- Numeric tuples encode `[ax,ay,az,bx,by,bz,nx,ny,nz]`: independent model-space
  endpoints followed by an outward unit normal. One source side is stored;
  the renderer mirrors x and nx to produce the opposite side. These guides
  share the body's camera, scale and centre. They reveal through covering
  anatomy; their own far-facing surface is hidden using the rotated normal.
- `anatomicalParts` maps each source component to its tuple range and signed
  contour indices: `i` selects local segment `i`; `-i-1` reverses its endpoints
  without changing its normal. Chains join only same-level, same-source-edge
  hits with exact matching endpoints and unambiguous degree two. Exact original
  OBJ vertex XYZ identifies export seams; no proximity welding is permitted.
  Never connect unrelated endpoints or bridge a culled segment or gap.
  Fourteen
  selections contain 63 source components. Chest and upper back also retain
  their original surface guides, replacing their old deep projections.
  Prepare those component ranges once per selection; project and paint each
  component's highlight/shade pair in source order. A single merged path
  loses the light fibre separations where components overlap.
- Cull every original segment before rendering each visible contour run. The
  projected coordinates use 0.1pt quantization; reduction may replace interior
  vertices only within 0.05pt of the replacement segment, preserving run
  endpoints, isolated caps and exact x/y extrema. Stored 3D tuples and normals
  remain complete. Only the relief highlight has a display offset; body
  visibility and hit targets stay independent of the overlay.
- Pectoralis minor remains a chest visual extension, without a catalogue
  entry or measured BoGa volume. Its shape has independently registered
  coordinates, rather than anchors on the body's chest patch.

## Sources and reproducibility

Unchanged surface fields and landmarks live in
`../../scripts/generate-muscle-body-fascicles.cjs` and
`../../scripts/muscle-body-fascicles-source.json`. Their literature informs
qualitative architecture only; publication figures and measured fascicle
directions are not copied.

The independent shapes derive from BodyParts3D 4.0's 99% polygon-reduced OBJ
release, © The Database Center for Life Science, under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The official [licence notice](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
and adaptations are also disclosed in the model's on-demand Information sheet.
This attribution covers the independent BodyParts3D-derived guides; the
unchanged reference body retains its existing provenance and rights.

For source regeneration, load `../../scripts/anatomy/source.json`: it pins
source URLs, individual OBJ SHA-256 checksums, source component names, body
registration and approved guide bounds. The checked-in offline intermediate
`../../scripts/anatomy/registered-guides.json.gz` hashes the uncompressed UTF-8
JSON bytes, independent of gzip headers. It stores only one side without
quantizing the approved endpoints/normals. Zero-length rounded segments are
discarded when building the runtime asset.
The separately pinned `../../scripts/anatomy/registered-topology.json.gz`
stores source cut levels and edge identities for lossless contour ordering;
its hash also covers uncompressed JSON.

To rebuild that intermediate, use Python 3 with NumPy (offline tooling only):

```sh
python3 apps/mobile/scripts/anatomy/fetch-source.py
python3 apps/mobile/scripts/anatomy/generate-guides.py
node apps/mobile/scripts/generate-muscle-body-fascicles.cjs
```

Both Python commands accept `--source-dir` for an existing OBJ cache. The
default cache is gitignored under `apps/mobile/artifacts/`. Fetching verifies
archive CRC/length and every pinned SHA-256 before accepting a source file.
Generation verifies all checksums again, then requires matching registration,
guide coverage and intermediate hash. A changed source or registration needs
review before updating those pins. Routine asset regeneration and Jest use
Node's standard library and the checked-in intermediate, without Python,
NumPy, source downloads or OBJ meshes in the mobile runtime.

Adaptations are pose alignment, bilateral mirroring and schematic fibre
generation. Atlas shape coverage does not validate the avatar registration,
individual fascicle directions, pennation or internal aponeuroses. Calf and
limb alignment uses avatar cross-section pose landmarks; torso adaptation is a
provisional deformation. Geometry checks establish reproducibility and extent,
not clinical anatomical accuracy. Source adductor minimus, multifidus, TFL
and intrinsic hand muscles are excluded; FJ1543 retains its generic spinalis
atlas label.
