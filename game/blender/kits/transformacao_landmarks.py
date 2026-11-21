"""Era 5 'Transformação Digital' hero landmarks (Phase 3 - T3.T2).

Builds the signature interactive landmarks in Blender space (+Z up, +Y forward):
  1. 6 Giant Project Cartridges + Console-Pedestals + Projection Screens (§4.5):
       - `Cartridge01..06` + `ProjectScreen01..06` for:
         dtcg-contrast, xbox-sales, snake-arena, meu-poupig, js-games, financial-sample-analysis
  2. Wedding Fairy-Light Arch under a blooming Ipê (`TransformacaoWeddingArch` + `TransformacaoWeddingIpe`)
  3. Backstage Room Trapdoor (`TransformacaoBackstageTrapdoor` + `BackstageTrapdoorHatch`)

All meshes share the single `'palette'` material via `vn_palette`.
"""

from __future__ import annotations

import math
from typing import Any

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from kits import transformacao_kit as tk
from lib import vn_collide, vn_palette, vn_scene


PROJECT_SPECS: tuple[dict[str, str], ...] = (
    {"id": "dtcg-contrast", "title": "dtcg-contrast", "accent": "signal", "icon": "contrast"},
    {"id": "xbox-sales", "title": "xbox-sales", "accent": "dataMint", "icon": "bars"},
    {"id": "snake-arena", "title": "snake-arena", "accent": "duskCoral", "icon": "snake"},
    {"id": "meu-poupig", "title": "Meu Poupig", "accent": "duskRose", "icon": "piggy"},
    {"id": "js-games", "title": "js-games", "accent": "fairyGold", "icon": "joystick"},
    {"id": "financial-sample-analysis", "title": "Financial Sample Analysis", "accent": "dataTeal", "icon": "pie"},
)


def _add_cartridge_icon(bm: bmesh.types.BMesh, icon: str, y_front: float, z_mid: float) -> None:
    """Add an original raised 3D ink/accent icon on the cartridge front label."""
    if icon == "contrast":
        tk._add_box(bm, (0.34, 0.05, 0.50), (-0.18, y_front, z_mid), "ink")
        tk._add_box(bm, (0.34, 0.05, 0.50), (0.18, y_front, z_mid), "paper")
        tk._add_box(bm, (0.20, 0.07, 0.20), (0.0, y_front - 0.01, z_mid), "signal")
    elif icon == "bars":
        heights = (0.24, 0.44, 0.34, 0.56)
        for i, h in enumerate(heights):
            tk._add_box(bm, (0.12, 0.05, h), (-0.27 + i * 0.18, y_front, z_mid - 0.28 + h * 0.5), "dataMint")
    elif icon == "snake":
        segs = ((-0.24, -0.14), (-0.08, -0.14), (0.08, -0.14), (0.08, 0.02), (0.08, 0.18), (0.24, 0.18))
        for sx, sz in segs:
            tk._add_box(bm, (0.13, 0.05, 0.13), (sx, y_front, z_mid + sz), "duskCoral")
        tk._add_box(bm, (0.11, 0.06, 0.11), (0.28, y_front - 0.01, z_mid - 0.12), "signal")
    elif icon == "piggy":
        tk._add_prism(bm, 0.26, 0.06, (0.0, y_front, z_mid), 10, "duskRose", rot_euler=(math.radians(90), 0.0, 0.0))
        tk._add_box(bm, (0.14, 0.07, 0.10), (0.26, y_front, z_mid - 0.02), "ink")
        tk._add_box(bm, (0.16, 0.07, 0.05), (0.0, y_front - 0.01, z_mid + 0.24), "fairyGold")
    elif icon == "joystick":
        tk._add_box(bm, (0.64, 0.05, 0.18), (0.0, y_front, z_mid - 0.16), "charcoal")
        tk._add_box(bm, (0.10, 0.06, 0.30), (-0.14, y_front, z_mid + 0.06), "ink")
        tk._add_prism(bm, 0.11, 0.06, (-0.14, y_front - 0.02, z_mid + 0.22), 8, "signal", rot_euler=(math.radians(90), 0.0, 0.0))
        tk._add_prism(bm, 0.07, 0.06, (0.18, y_front - 0.01, z_mid - 0.04), 8, "fairyGold", rot_euler=(math.radians(90), 0.0, 0.0))
    elif icon == "pie":
        tk._add_prism(bm, 0.28, 0.05, (0.0, y_front, z_mid), 12, "dataTeal", rot_euler=(math.radians(90), 0.0, 0.0))
        tk._add_box(bm, (0.22, 0.07, 0.22), (0.11, y_front - 0.01, z_mid + 0.11), "fairyGold")


def build_project_station(
    index: int,
    spec: dict[str, str],
    location: tuple[float, float, float],
    rot_z_deg: float,
    collection: bpy.types.Collection,
) -> dict[str, bpy.types.Object]:
    """Build Console-Pedestal + Giant Cartridge + Projection Screen for one project."""
    tag = f"{index:02d}"
    lx, ly, lz = location
    rad = math.radians(rot_z_deg)
    ca, sa = math.cos(rad), math.sin(rad)

    def _world_pt(dx: float, dy: float, dz: float) -> tuple[float, float, float]:
        return (lx + dx * ca - dy * sa, ly + dx * sa + dy * ca, lz + dz)

    # 1. Static Console-Pedestal
    bm_ped = bmesh.new()
    tk._add_box(bm_ped, (2.2, 1.5, 0.22), (0.0, 0.0, 0.11), "charcoal")
    tk._add_box(bm_ped, (1.8, 1.2, 0.78), (0.0, 0.0, 0.61), "nightPlum")
    # Cartridge slot recess + stamp button
    tk._add_box(bm_ped, (1.28, 0.42, 0.10), (0.0, 0.08, 1.02), "ink")
    tk._add_prism(bm_ped, 0.22, 0.10, (0.0, -0.44, 1.02), 10, "signal")
    tk._add_box(bm_ped, (1.5, 0.08, 0.36), (0.0, -0.61, 0.62), spec["accent"])
    ped_vis = tk._finalize_bmesh(
        f"TransformacaoPedestal{tag}",
        bm_ped,
        collection,
        location=location,
        rot_z_deg=rot_z_deg,
        bevel_width=0.012,
    )

    ped_phys = tk._make_physical_root(f"TransformacaoPedestal{tag}", "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboidPedestal{tag}",
        (2.1, 1.4, 1.05),
        location=(0.0, 0.0, 0.525),
        parent=ped_phys,
        collection=collection,
        engine_coords=False,
    )

    # 2. Interactive Giant Cartridge (`Cartridge01..06`, exported in transformacaoObjects.glb)
    bm_cart = bmesh.new()
    # Main shell
    tk._add_box(bm_cart, (1.16, 0.32, 1.38), (0.0, 0.0, 0.85), "paperShadow")
    # Top grip cap + side ribs
    tk._add_box(bm_cart, (1.22, 0.36, 0.22), (0.0, 0.0, 1.52), spec["accent"])
    for rz in (1.16, 1.28, 1.40):
        tk._add_box(bm_cart, (1.22, 0.34, 0.04), (0.0, 0.0, rz), "charcoal")
    # Bottom gold contact pins
    for px in (-0.36, -0.18, 0.0, 0.18, 0.36):
        tk._add_box(bm_cart, (0.10, 0.14, 0.16), (px, 0.0, 0.08), "ipeGold")
    # Front label plate + unique 3D icon
    tk._add_box(bm_cart, (0.94, 0.04, 0.86), (0.0, -0.17, 0.86), "paperWarm")
    _add_cartridge_icon(bm_cart, spec["icon"], y_front=-0.20, z_mid=0.86)

    cart_loc = _world_pt(0.0, 0.08, 1.22)
    cart_obj = tk._finalize_bmesh(
        f"Cartridge{tag}",
        bm_cart,
        collection,
        location=cart_loc,
        rot_z_deg=rot_z_deg,
        bevel_width=0.01,
    )
    cart_obj["projectId"] = spec["id"]
    cart_obj["projectIndex"] = index
    cart_obj["interactive"] = "project_cartridge"

    # 3. Interactive Projection Screen (`ProjectScreen01..06`, exported in transformacaoObjects.glb)
    bm_scr = bmesh.new()
    # Support poles behind pedestal
    tk._add_box(bm_scr, (0.14, 0.14, 2.2), (-1.45, 0.0, 1.10), "charcoal")
    tk._add_box(bm_scr, (0.14, 0.14, 2.2), (1.45, 0.0, 1.10), "charcoal")
    # Outer bezel (16:9 ratio ~ 3.2 x 1.8 m)
    tk._add_box(bm_scr, (3.44, 0.14, 2.02), (0.0, 0.0, 2.55), "ink")
    tk._add_box(bm_scr, (3.34, 0.16, 1.92), (0.0, 0.0, 2.55), spec["accent"])
    # Screen face
    tk._add_box(bm_scr, (3.20, 0.18, 1.80), (0.0, -0.02, 2.55), "nightPlum")
    # Fairy-gold corner brackets
    for sx in (-1.62, 1.62):
        for sz in (1.62, 3.48):
            tk._add_box(bm_scr, (0.16, 0.20, 0.16), (sx, -0.02, sz), "fairyGold")

    scr_loc = _world_pt(0.0, 1.85, 0.0)
    scr_obj = tk._finalize_bmesh(
        f"ProjectScreen{tag}",
        bm_scr,
        collection,
        location=scr_loc,
        rot_z_deg=rot_z_deg,
        bevel_width=0.01,
    )
    scr_obj["projectId"] = spec["id"]
    scr_obj["projectIndex"] = index
    scr_obj["screenImage"] = f"projects/{spec['id']}.webp"

    # Separate 16:9 screen face mesh (`ProjectScreen01Face..06Face`) with 0..1 UVs
    bm_face = bmesh.new()
    uv_layer = bm_face.loops.layers.uv.verify()
    v0 = bm_face.verts.new((-1.60, -0.112, 1.65))
    v1 = bm_face.verts.new((1.60, -0.112, 1.65))
    v2 = bm_face.verts.new((1.60, -0.112, 3.45))
    v3 = bm_face.verts.new((-1.60, -0.112, 3.45))
    face = bm_face.faces.new((v0, v1, v2, v3))
    uvs = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for loop, uv in zip(face.loops, uvs):
        loop[uv_layer].uv = uv
    scr_face_obj = tk._finalize_bmesh(
        f"ProjectScreen{tag}Face",
        bm_face,
        collection,
        location=scr_loc,
        rot_z_deg=rot_z_deg,
        bevel_width=0.0,
    )
    scr_face_obj["projectId"] = spec["id"]
    scr_face_obj["projectIndex"] = index
    scr_face_obj["screenImage"] = f"projects/{spec['id']}.webp"

    scr_phys = tk._make_physical_root(f"TransformacaoScreen{tag}", "fixed", scr_loc, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboidScreen{tag}",
        (3.4, 0.3, 3.5),
        location=(0.0, 0.0, 1.75),
        parent=scr_phys,
        collection=collection,
        engine_coords=False,
    )

    return {
        "pedestal": ped_vis,
        "cartridge": cart_obj,
        "screen": scr_obj,
    }


def build_wedding_arch(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, bpy.types.Object]:
    """Build the Wedding Fairy-Light Arch under a blooming golden Ipê tree."""
    bm = bmesh.new()
    # Ceremonial stone platform
    tk._add_prism(bm, 3.8, 0.24, (0.0, 0.0, 0.12), 16, "paperWarm")
    tk._add_prism(bm, 3.3, 0.08, (0.0, 0.0, 0.26), 16, "duskRose")
    # Timber arch pillars
    tk._add_box(bm, (0.34, 0.34, 3.6), (-1.75, 0.0, 2.05), "wood")
    tk._add_box(bm, (0.34, 0.34, 3.6), (1.75, 0.0, 2.05), "wood")
    # Curved/stepped arch top beam
    tk._add_box(bm, (4.1, 0.40, 0.32), (0.0, 0.0, 3.92), "wood")
    tk._add_box(bm, (2.6, 0.44, 0.28), (0.0, 0.0, 4.20), "paper")
    # Paper-cut flower garlands & fairy-gold lights along the arch
    for i in range(9):
        fx = -1.6 + i * 0.40
        fz = 3.85 + 0.30 * math.cos((fx / 1.8) * 1.4)
        swatch = "duskRose" if i % 2 == 0 else "ipeGold"
        tk._add_icosphere(bm, 0.18, (fx, -0.22, fz), swatch, subdivisions=1)
        tk._add_icosphere(bm, 0.11, (fx, 0.22, fz - 0.22), "fairyGold", subdivisions=1)
    # Side fairy-light bulbs down pillars
    for side in (-1.75, 1.75):
        for pz in (1.2, 2.0, 2.8, 3.5):
            tk._add_box(bm, (0.14, 0.14, 0.14), (side, -0.22, pz), "fairyGold")

    arch_vis = tk._finalize_bmesh(
        name,
        bm,
        collection,
        location=location,
        rot_z_deg=rot_z_deg,
        bevel_width=0.01,
    )

    arch_phys = tk._make_physical_root(name, "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboid{name}Left",
        (0.45, 0.45, 3.8),
        location=(-1.75, 0.0, 1.9),
        parent=arch_phys,
        collection=collection,
        engine_coords=False,
    )
    vn_collide.add_cuboid(
        f"cuboid{name}Right",
        (0.45, 0.45, 3.8),
        location=(1.75, 0.0, 1.9),
        parent=arch_phys,
        collection=collection,
        engine_coords=False,
    )

    # Blooming golden Ipê overarching the arch
    lx, ly, lz = location
    rad = math.radians(rot_z_deg)
    ipe_loc = (lx + 3.2 * math.cos(rad) - 2.2 * math.sin(rad), ly + 3.2 * math.sin(rad) + 2.2 * math.cos(rad), lz)
    ipe_vis = tk.build_dusk_tree("TransformacaoWeddingIpe", ipe_loc, collection, height=6.4, crown_swatch="ipeGold")
    return {"arch": arch_vis, "ipe": ipe_vis, "physical": arch_phys}


def build_backstage_trapdoor(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, bpy.types.Object]:
    """Build the Backstage Credits Room trapdoor (`refSecretBackstage`)."""
    bm_frame = bmesh.new()
    tk._add_box(bm_frame, (2.4, 2.4, 0.18), (0.0, 0.0, 0.09), "copperShadow")
    tk._add_box(bm_frame, (2.1, 2.1, 0.22), (0.0, 0.0, 0.11), "ink")
    frame_vis = tk._finalize_bmesh(
        f"{name}Frame",
        bm_frame,
        collection,
        location=location,
        rot_z_deg=rot_z_deg,
        bevel_width=0.01,
    )

    bm_hatch = bmesh.new()
    tk._add_box(bm_hatch, (1.85, 1.85, 0.14), (0.0, 0.0, 0.24), "copper")
    tk._add_box(bm_hatch, (0.28, 0.14, 0.08), (-0.65, 0.90, 0.33), "ink")
    tk._add_box(bm_hatch, (0.28, 0.14, 0.08), (0.65, 0.90, 0.33), "ink")
    tk._add_prism(bm_hatch, 0.32, 0.06, (0.0, 0.0, 0.33), 12, "signal")
    hatch_obj = tk._finalize_bmesh(
        "BackstageTrapdoorHatch",
        bm_hatch,
        collection,
        location=location,
        rot_z_deg=rot_z_deg,
        bevel_width=0.01,
    )
    hatch_obj["interactive"] = "secret_backstage"

    phys = tk._make_physical_root(name, "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboid{name}",
        (2.3, 2.3, 0.28),
        location=(0.0, 0.0, 0.14),
        parent=phys,
        collection=collection,
        engine_coords=False,
    )
    return {"frame": frame_vis, "hatch": hatch_obj, "physical": phys}
