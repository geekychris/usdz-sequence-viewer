"""
Blender headless converter: USDZ (incl. USDC-format) → GLB.

Usage:
    blender --background --python tools/usdz_to_glb.py -- input.usdz output.glb
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index('--') + 1:]
input_path = os.path.abspath(argv[0])
output_path = os.path.abspath(argv[1])

# Start from an empty scene to avoid inheriting defaults (cube, light, camera).
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import the USD/USDZ file (Blender 3.5+ has native USD import).
bpy.ops.wm.usd_import(filepath=input_path)

# Export as GLB.
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    export_yup=True,            # keep Y-up (three.js default; our viewer re-orients for Z-up)
    export_apply=True,          # apply modifiers
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)

print(f"[usdz_to_glb] wrote {output_path}")
