# Models

Drop `.glb` / `.gltf` files here and reference them from the
`ASSET_MANIFEST` in `src/App.tsx` (served as `/models/<file>.glb`).

The default manifest expects:

- `precision_tool.glb` — held tool, profile A (precision)
- `kinetic_tool.glb` — held tool, profile B (kinetic)
- `prop_crate.glb` — grabbable prop, precision-targetable

Authoring conventions:

- Real-world meters; the engine generates colliders from the mesh at its
  natural scale (use the `scale` prop for adjustments).
- Tool models should point down **-Z** with the grip at the origin; otherwise
  set `gripPosition` / `gripRotation` on the manifest entry.

Missing files are fine — a primitive stand-in mounts with the same physics.

GLB files are not committed (third-party licenses). To restore the Khronos
sample models used during development, run from the project root:

```powershell
$base = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models"
Invoke-WebRequest "$base/Avocado/glTF-Binary/Avocado.glb" -OutFile "public\models\precision_tool.glb"
Invoke-WebRequest "$base/Duck/glTF-Binary/Duck.glb" -OutFile "public\models\kinetic_tool.glb"
Invoke-WebRequest "$base/Box/glTF-Binary/Box.glb" -OutFile "public\models\prop_crate.glb"
```

