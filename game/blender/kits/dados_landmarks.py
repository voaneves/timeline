"""Hero landmarks and interactive set-pieces for Era 4 'Dados' (2019–2021).

  - `make_regression_constellation`: upper-ridge scatter plot deck (`DadosScatterDeck`),
    12 glowing `dataGold` scatter nodes (`DadosScatterNode01..12`), and the
    illuminable `DadosRegressionLine` beam.
  - `make_secret_confusion_matrix`: 2x2 recessed confusion-matrix chamber
    (`DadosSecretMatrix`) with TP/FP/FN/TN quadrant tiles and interactive
    Stamp-opened hatch (`DadosSecretMatrixHatch`).
  - `make_tocantins_arch`: riverside timber/paper frame rhyming with Era 1.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Euler, Vector

from kits import dados_kit
from lib import vn_scene


def make_regression_constellation(
    deck_location: tuple[float, float, float] = (2.0, 32.0, 3.20),
    static_collection: bpy.types.Collection | str | None = None,
    dyn_collection: bpy.types.Collection | str | None = None,
) -> dict[str, object]:
    """Create the Regression Constellation deck, 12 scatter nodes, and regression line.

    Returns dict with `deck_obj`, `nodes` (`DadosScatterNode01..12`), and
    `regression_line` (`DadosRegressionLine`).
    """
    dx, dy, dz = (float(v) for v in deck_location)

    # Static scatter-plot deck & axes
    bm = bmesh.new()
    # Recessed slate scatter canvas (18.0 x 12.0 m)
    dados_kit._add_box(bm, (18.0, 12.0, 0.18), (0.0, 0.0, 0.09), "dataSlate", top_swatch="dataSlate")
    # Paper grid lines (4 horizontal, 5 vertical)
    for gy in (-4.0, -1.5, 1.0, 3.5):
        dados_kit._add_box(bm, (17.2, 0.08, 0.03), (0.0, gy, 0.19), "paperShadow")
    for gx in (-6.5, -3.2, 0.1, 3.4, 6.7):
        dados_kit._add_box(bm, (0.08, 11.2, 0.03), (gx, 0.0, 0.19), "paperShadow")
    # Ink L-axis rails along bottom (-Y) and left (-X)
    dados_kit._add_box(bm, (18.2, 0.30, 0.28), (0.0, -5.85, 0.24), "ink")
    dados_kit._add_box(bm, (0.30, 12.2, 0.28), (-8.85, 0.0, 0.24), "ink")
    # Axis end-caps in dataMint
    dados_kit._add_box(bm, (0.52, 0.52, 0.42), (9.0, -5.85, 0.32), "dataMint")
    dados_kit._add_box(bm, (0.52, 0.52, 0.42), (-8.85, 6.0, 0.32), "dataMint")

    deck_obj = dados_kit._finalize_bm(
        bm,
        name="DadosScatterDeck",
        location=(dx, dy, dz),
        collection=static_collection,
    )

    # 12 scatter nodes along a diagonal linear trend from (-7.2, -4.0) to (7.2, 4.2)
    offsets = (
        (-7.2, -4.0, 0.72),
        (-6.0, -2.5, 0.95),
        (-4.7, -3.1, 0.85),
        (-3.4, -1.3, 1.12),
        (-2.1, -1.8, 1.04),
        (-0.8, -0.1, 1.28),
        (0.5, 0.9, 1.38),
        (1.8, 0.2, 1.30),
        (3.1, 2.1, 1.52),
        (4.4, 1.5, 1.46),
        (5.7, 3.4, 1.66),
        (7.1, 4.1, 1.78),
    )
    nodes: list[bpy.types.Object] = []
    for idx, (ox, oy, oz) in enumerate(offsets, start=1):
        bm_n = bmesh.new()
        dados_kit._add_octahedron(bm_n, 0.34, (0.0, 0.0, 0.0), "dataGold")
        # Small ink equatorial ring accent
        dados_kit._add_prism(bm_n, 0.38, 0.05, 8, (0.0, 0.0, 0.0), "ink")
        node_obj = dados_kit._finalize_bm(
            bm_n,
            name=f"DadosScatterNode{idx:02d}",
            location=(dx + ox, dy + oy, dz + oz),
            collection=dyn_collection,
        )
        vn_scene.set_custom_props(
            node_obj,
            {
                "category": "scatterNode",
                "nodeIndex": idx,
                "alignedZ": round(dz + 0.70 + (idx - 1) * 0.095, 3),
            },
        )
        nodes.append(node_obj)

    # Regression line beam spanning the scatter constellation
    p0 = Vector((dx - 7.6, dy - 4.2, dz + 0.72))
    p1 = Vector((dx + 7.6, dy + 4.3, dz + 1.82))
    delta = p1 - p0
    length = delta.length
    mid = (p0 + p1) * 0.5
    yaw = math.atan2(delta.y, delta.x)
    pitch = -math.asin(delta.z / max(length, 1e-4))

    bm_l = bmesh.new()
    dados_kit._add_box(bm_l, (length, 0.18, 0.18), (0.0, 0.0, 0.0), "dataGold")
    dados_kit._add_box(bm_l, (length + 0.12, 0.08, 0.24), (0.0, 0.0, 0.0), "signal")
    reg_line = dados_kit._finalize_bm(
        bm_l,
        name="DadosRegressionLine",
        location=(mid.x, mid.y, mid.z),
        rotation_euler=(0.0, pitch, yaw),
        collection=dyn_collection,
    )
    vn_scene.set_custom_props(
        reg_line,
        {
            "category": "regressionLine",
            "illuminated": False,
        },
    )

    return {
        "deck_obj": deck_obj,
        "nodes": nodes,
        "regression_line": reg_line,
    }


def make_secret_confusion_matrix(
    name: str = "DadosSecretMatrix",
    location: tuple[float, float, float] = (18.0, 12.0, 0.20),
    static_collection: bpy.types.Collection | str | None = None,
    dyn_collection: bpy.types.Collection | str | None = None,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Create the 2x2 Confusion Matrix recessed secret chamber & Stamp-opened hatch.

    Returns `(chamber_obj, hatch_obj)`.
    """
    bm = bmesh.new()

    # Outer chamber surround (5.2 x 5.2 m footprint, walls 1.25 m high)
    dados_kit._add_box(bm, (5.2, 5.2, 0.22), (0.0, 0.0, 0.11), "dataSlate")
    dados_kit._add_box(bm, (0.45, 5.2, 1.25), (-2.38, 0.0, 0.62), "ink", top_swatch="dataTeal")
    dados_kit._add_box(bm, (0.45, 5.2, 1.25), (2.38, 0.0, 0.62), "ink", top_swatch="dataTeal")
    dados_kit._add_box(bm, (4.3, 0.45, 1.25), (0.0, 2.38, 0.62), "ink", top_swatch="dataTeal")
    dados_kit._add_box(bm, (4.3, 0.45, 1.25), (0.0, -2.38, 0.62), "ink", top_swatch="dataTeal")

    # 2x2 Confusion Matrix floor quadrants (TP, FP, FN, TN) inside chamber
    quads = (
        ((-1.05, 1.05), "dataMint"),   # Top-Left: True Positive
        ((1.05, 1.05), "signal"),      # Top-Right: False Positive
        ((-1.05, -1.05), "dataGold"),  # Bottom-Left: False Negative
        ((1.05, -1.05), "dataTeal"),   # Bottom-Right: True Negative
    )
    for (qx, qy), sw in quads:
        dados_kit._add_box(bm, (1.92, 1.92, 0.10), (qx, qy, 0.26), sw)

    # Ink 2x2 divider crossbars inside chamber
    dados_kit._add_box(bm, (4.2, 0.14, 0.14), (0.0, 0.0, 0.29), "paper")
    dados_kit._add_box(bm, (0.14, 4.2, 0.14), (0.0, 0.0, 0.29), "paper")

    # Paper-and-dataMint rim curb
    dados_kit._add_box(bm, (5.3, 0.16, 0.14), (0.0, -2.58, 1.28), "dataMint")
    dados_kit._add_box(bm, (5.3, 0.16, 0.14), (0.0, 2.58, 1.28), "dataMint")
    dados_kit._add_box(bm, (0.16, 5.3, 0.14), (-2.58, 0.0, 1.28), "dataMint")
    dados_kit._add_box(bm, (0.16, 5.3, 0.14), (2.58, 0.0, 1.28), "dataMint")

    chamber_obj = dados_kit._finalize_bm(
        bm,
        name=name,
        location=location,
        collection=static_collection,
    )

    # Interactive Hatch (`DadosSecretMatrixHatch`) with 2x2 embossed matrix motif
    bm_h = bmesh.new()
    dados_kit._add_box(bm_h, (4.25, 4.25, 0.20), (0.0, 0.0, 0.0), "dataSlate", top_swatch="paper")
    for (qx, qy), sw in quads:
        dados_kit._add_box(bm_h, (1.65, 1.65, 0.06), (qx, qy, 0.12), sw)
    dados_kit._add_box(bm_h, (4.10, 0.18, 0.08), (0.0, 0.0, 0.13), "ink")
    dados_kit._add_box(bm_h, (0.18, 4.10, 0.08), (0.0, 0.0, 0.13), "ink")
    # Center Stamp target ring
    dados_kit._add_prism(bm_h, 0.56, 0.12, 8, (0.0, 0.0, 0.18), "copper")
    dados_kit._add_prism(bm_h, 0.24, 0.16, 8, (0.0, 0.0, 0.22), "signal")

    hatch_loc = (location[0], location[1], location[2] + 1.22)
    hatch_obj = dados_kit._finalize_bm(
        bm_h,
        name="DadosSecretMatrixHatch",
        location=hatch_loc,
        collection=dyn_collection,
    )
    vn_scene.set_custom_props(
        hatch_obj,
        {
            "category": "secretMatrixHatch",
            "trigger": "stamp",
        },
    )

    return chamber_obj, hatch_obj


def make_tocantins_arch(
    name: str = "DadosTocantinsArch",
    location: tuple[float, float, float] = (-11.0, 5.5, 0.24),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a stylized timber & paper riverside arch rhyming with Era 1 Tocantins."""
    bm = bmesh.new()
    dados_kit._add_box(bm, (0.36, 0.36, 3.2), (-2.1, 0.0, 1.6), "woodDark")
    dados_kit._add_box(bm, (0.36, 0.36, 3.2), (2.1, 0.0, 1.6), "woodDark")
    dados_kit._add_box(bm, (5.0, 0.44, 0.36), (0.0, 0.0, 3.25), "paper", top_swatch="copper")
    dados_kit._add_box(bm, (1.2, 0.48, 0.22), (0.0, 0.0, 3.52), "signal")
    return dados_kit._finalize_bm(bm, name=name, location=location, collection=collection)
