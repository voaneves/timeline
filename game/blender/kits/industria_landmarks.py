"""Hero landmarks and interactive set-pieces for Era 3 'Indústria'.

  - `make_paper_airship`: Stylized folded-paper airship ('Dirigível de Papel')
    docked at `refAirshipDock` ready to fly to Alemanha island.
  - `make_secret_gear_vault`: Gear-vault chamber + interactive hatch
    (`IndustriaSecretVaultHatch`) opened by Stamp.
  - `make_control_console`: Trainee Tower control desk (`IndustriaTraineeConsole`).
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Euler, Vector

from kits import industria_kit
from lib import vn_palette, vn_scene


def make_paper_airship(
    name: str = "IndustriaPaperAirship",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a stylized folded-paper airship ('Dirigível de Papel').

    Length ~ 7.6 m along Y, hull radius ~ 1.55 m, with crisp faceted origami folds,
    red `signal` tail fins, and a `copper` & `ink` suspended gondola + rear propeller.
    """
    bm = bmesh.new()

    # Faceted origami envelope along Y axis (nose at +Y, tail at -Y)
    # 7 cross-section rings along Y
    rings_spec: list[tuple[float, float, float]] = [
        (3.80, 0.08, 0.08),   # nose tip
        (2.85, 0.95, 0.85),   # forward taper
        (1.20, 1.55, 1.38),   # forward hull
        (-0.40, 1.62, 1.44),  # mid hull
        (-2.00, 1.32, 1.18),  # aft hull
        (-3.20, 0.62, 0.56),  # tail taper
        (-3.80, 0.12, 0.12),  # tail tip
    ]
    segs = 8  # octagonal origami facets
    ring_verts: list[list[bmesh.types.BMVert]] = []
    for y_pos, rx, rz in rings_spec:
        ring: list[bmesh.types.BMVert] = []
        for s in range(segs):
            ang = (2.0 * math.pi * s) / segs + (math.pi / segs)
            vx = math.cos(ang) * rx
            vz = math.sin(ang) * rz + 1.85
            ring.append(bm.verts.new((vx, y_pos, vz)))
        ring_verts.append(ring)

    hull_faces: list[bmesh.types.BMFace] = []
    for r_idx in range(len(ring_verts) - 1):
        r0 = ring_verts[r_idx]
        r1 = ring_verts[r_idx + 1]
        for s in range(segs):
            s_next = (s + 1) % segs
            f = bm.faces.new((r0[s], r0[s_next], r1[s_next], r1[s]))
            hull_faces.append(f)

    # Cap nose and tail
    hull_faces.append(bm.faces.new(ring_verts[0]))
    hull_faces.append(bm.faces.new(list(reversed(ring_verts[-1]))))

    bm.normal_update()
    for f in hull_faces:
        if f.normal.z > 0.25:
            industria_kit._assign_uv(bm, [f], "paper")
        elif f.normal.z < -0.25:
            industria_kit._assign_uv(bm, [f], "paperShadow")
        else:
            industria_kit._assign_uv(bm, [f], "paperWarm")

    # Folded red signal tail fins (top, bottom, left, right)
    industria_kit._add_box(bm, (0.10, 1.45, 1.15), (0.0, -2.75, 2.75), "signal", rotation_euler=(math.radians(-18.0), 0.0, 0.0))
    industria_kit._add_box(bm, (0.10, 1.25, 0.85), (0.0, -2.75, 1.05), "signal", rotation_euler=(math.radians(16.0), 0.0, 0.0))
    industria_kit._add_box(bm, (1.15, 1.35, 0.10), (-1.20, -2.75, 1.85), "signal")
    industria_kit._add_box(bm, (1.15, 1.35, 0.10), (1.20, -2.75, 1.85), "signal")

    # Ink paper-crease accent band around mid-hull
    industria_kit._add_prism(
        bm,
        1.64,
        0.16,
        8,
        (0.0, 0.40, 1.85),
        "signal",
        rotation_euler=(math.radians(90.0), 0.0, math.radians(22.5)),
    )

    # Suspended copper & ink gondola beneath hull (z ~ 0.0..0.65)
    industria_kit._add_box(bm, (0.95, 2.40, 0.56), (0.0, 0.10, 0.28), "copper")
    industria_kit._add_box(bm, (0.85, 1.80, 0.28), (0.0, 0.10, 0.58), "ink")
    # Gondola suspension struts
    for sx in (-0.42, 0.42):
        for sy in (-0.75, 0.85):
            industria_kit._add_box(bm, (0.07, 0.07, 0.65), (sx, sy, 0.72), "steelDark")

    # Rear propeller hub & blades
    industria_kit._add_prism(bm, 0.14, 0.30, 8, (0.0, -1.22, 0.28), "steelDark", rotation_euler=(math.radians(90.0), 0.0, 0.0))
    industria_kit._add_box(bm, (1.10, 0.06, 0.16), (0.0, -1.38, 0.28), "copper")
    industria_kit._add_box(bm, (0.16, 0.06, 1.10), (0.0, -1.38, 0.28), "copper")

    return industria_kit._finalize_bm(
        bm,
        name=name,
        location=location,
        rotation_euler=rotation_euler,
        collection=collection,
    )


def make_secret_gear_vault(
    name: str = "IndustriaSecretVault",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Create the Secret Gear-Vault chamber and interactive Stamp-opened hatch.

    Returns `(chamber_obj, hatch_obj)`.
    - `chamber_obj`: recessed brick & steel-dark vault surround with interior copper gears.
    - `hatch_obj`: `IndustriaSecretVaultHatch` interactive lid with safety-yellow trim & gear lock.
    """
    bm = bmesh.new()

    # Vault floor & recessed chamber walls (4.2 x 4.2 m footprint)
    industria_kit._add_box(bm, (4.4, 4.4, 0.24), (0.0, 0.0, 0.12), "steelDark")
    industria_kit._add_box(bm, (0.45, 4.4, 1.25), (-1.98, 0.0, 0.62), "brickDark", top_swatch="steel")
    industria_kit._add_box(bm, (0.45, 4.4, 1.25), (1.98, 0.0, 0.62), "brickDark", top_swatch="steel")
    industria_kit._add_box(bm, (3.6, 0.45, 1.25), (0.0, 1.98, 0.62), "brickDark", top_swatch="steel")
    industria_kit._add_box(bm, (3.6, 0.45, 1.25), (0.0, -1.98, 0.62), "brickDark", top_swatch="steel")

    # Safety-yellow rim curb
    industria_kit._add_box(bm, (4.5, 0.16, 0.14), (0.0, -2.18, 1.28), "safetyYellow")
    industria_kit._add_box(bm, (4.5, 0.16, 0.14), (0.0, 2.18, 1.28), "safetyYellow")
    industria_kit._add_box(bm, (0.16, 4.5, 0.14), (-2.18, 0.0, 1.28), "safetyYellow")
    industria_kit._add_box(bm, (0.16, 4.5, 0.14), (2.18, 0.0, 1.28), "safetyYellow")

    chamber_obj = industria_kit._finalize_bm(
        bm,
        name=name,
        location=location,
        collection=collection,
    )

    # Interactive Vault Hatch (`IndustriaSecretVaultHatch`)
    bm_h = bmesh.new()
    industria_kit._add_box(bm_h, (3.50, 3.50, 0.22), (0.0, 0.0, 0.0), "steel", top_swatch="steelDark")
    # Hazard stripes & copper lock ring
    for sx in (-1.2, 0.0, 1.2):
        industria_kit._add_box(bm_h, (0.36, 3.30, 0.04), (sx, 0.0, 0.12), "safetyYellow")
    industria_kit._add_prism(bm_h, 0.68, 0.14, 12, (0.0, 0.0, 0.16), "copper")
    industria_kit._add_prism(bm_h, 0.28, 0.20, 8, (0.0, 0.0, 0.22), "signal")

    hatch_loc = (location[0], location[1], location[2] + 1.22)
    hatch_obj = industria_kit._finalize_bm(
        bm_h,
        name="IndustriaSecretVaultHatch",
        location=hatch_loc,
        collection=collection,
    )
    vn_scene.set_custom_props(
        hatch_obj,
        {
            "category": "secretVaultHatch",
            "trigger": "stamp",
        },
    )

    return chamber_obj, hatch_obj


def make_control_console(
    name: str = "IndustriaTraineeConsole",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the Trainee Tower industrial control console (zero brand logos)."""
    bm = bmesh.new()

    # Pedestal & angled desk
    industria_kit._add_box(bm, (1.60, 0.72, 0.90), (0.0, 0.0, 0.45), "steelDark")
    industria_kit._add_box(
        bm,
        (1.75, 0.88, 0.18),
        (0.0, -0.04, 0.96),
        "steel",
        rotation_euler=(math.radians(-14.0), 0.0, 0.0),
    )
    # Paper blueprint sheet & status indicator buttons
    industria_kit._add_box(
        bm,
        (0.75, 0.52, 0.03),
        (-0.36, -0.04, 1.06),
        "paper",
        rotation_euler=(math.radians(-14.0), 0.0, 0.0),
    )
    for idx, (bx, sw) in enumerate(((0.25, "signal"), (0.45, "ipeGold"), (0.65, "dataMint"))):
        industria_kit._add_prism(bm, 0.06, 0.08, 8, (bx, -0.10, 1.07), sw)

    return industria_kit._finalize_bm(
        bm,
        name=name,
        location=location,
        rotation_euler=rotation_euler,
        collection=collection,
    )
