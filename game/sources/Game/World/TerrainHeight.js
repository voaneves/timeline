/**
 * Shared analytical heightfield for the Stage 1 stylized Toy/Clay Island.
 * Matches `game/blender/eras/origens.py` 1:1 so visual mesh, Rapier trimesh collider,
 * grass placement, shore foam, and footprints align with zero drift.
 * Sea level = -0.35 m.
 */

function smoothstep(edge0, edge1, x)
{
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}

function mix(a, b, t)
{
    return a + (b - a) * t
}

function padRectBlend(x, z, xMin, xMax, zMin, zMax, feather)
{
    const dx = x < xMin ? (xMin - x) : (x > xMax ? (x - xMax) : 0)
    const dz = z < zMin ? (zMin - z) : (z > zMax ? (z - zMax) : 0)
    const d = Math.hypot(dx, dz)
    return 1 - smoothstep(0, feather, d)
}

function distToSegment(px, pz, ax, az, bx, bz)
{
    const abx = bx - ax
    const abz = bz - az
    const len2 = abx * abx + abz * abz
    if(len2 < 1e-6)
        return Math.hypot(px - ax, pz - az)
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2))
    return Math.hypot(px - (ax + abx * t), pz - (az + abz * t))
}

export const SEA_LEVEL_Y = -0.35

export const ISLAND_PATH_POLYLINES = [
    [ [ -17.0, 3.8 ], [ 15.0, 3.8 ] ], // South sandy-earth lane (zero z-fighting, baked into terrain)
    [ [ 0.0, 2.0 ], [ 4.5, -5.2 ], [ 9.5, -10.0 ], [ 14.0, -20.5 ] ],
    [ [ 0.0, 2.0 ], [ -7.5, 1.5 ] ],
    [ [ 0.0, 2.0 ], [ -11.0, -7.0 ], [ -12.5, -18.0 ] ],
]

/**
 * Evaluate exact island terrain height Y (in Three.js Y-up) at world (x, z).
 */
export function sampleIslandHeight(x, z)
{
    // Island center at (0, -18) covering Z in [-48..+10], X in [-34..+34]
    const cx = x / 35.0
    const cz = (z + 18.0) / 30.0
    const angle = Math.atan2(cz, cx)
    const rNorm = Math.hypot(cx, cz)
    const coastMod = 1.0 + 0.07 * Math.sin(angle * 2.0 + 0.4) + 0.05 * Math.cos(angle * 3.0 - 0.7)

    // Smooth coastal drop from 0.0 m inland -> -0.35 m shoreline -> -1.35 m seabed
    const coastT = smoothstep(0.78 * coastMod, 1.06 * coastMod, rNorm)
    let h = mix(0.0, -1.35, coastT)

    // Gentle interior rolling hills away from flat landmark pads
    const inland = 1 - smoothstep(0.65 * coastMod, 0.90 * coastMod, rNorm)
    h += (0.28 * Math.sin(x * 0.14 + 0.4) * Math.cos(z * 0.13 - 0.2)) * inland

    // Smoothly blended plateau pads matching all existing interactive landmarks & nav nodes
    // 1. Spawn / Street / O2 1994 House lowland pad -> y = 0.0 m
    h = mix(h, 0.0, padRectBlend(x, z, -18.0, 18.0, -12.0, 6.5, 5.5))
    // 2. O8 West School Terrace -> y = 0.80 m (smooth ramp feather = 5.5 m)
    h = mix(h, 0.80, padRectBlend(x, z, -24.0, -5.0, -26.5, -10.5, 5.5))
    // 3. North Meadow Plateau (O6, O7, O9, O10) -> y = 1.60 m (smooth ramp feather = 6.5 m)
    h = mix(h, 1.60, padRectBlend(x, z, -23.0, 19.0, -45.5, -26.5, 6.5))
    // 4. O5 Overlook / CRT Hill -> y = 2.40 m (smooth ramp feather = 6.5 m)
    h = mix(h, 2.40, padRectBlend(x, z, 8.0, 22.5, -29.0, -17.0, 6.5))

    return h
}

export function distanceToPath(x, z)
{
    let best = Infinity
    for(const poly of ISLAND_PATH_POLYLINES)
    {
        for(let i = 0; i < poly.length - 1; i++)
        {
            const d = distToSegment(x, z, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1])
            if(d < best)
                best = d
        }
    }
    return best
}

export function sampleIslandSurface(x, z)
{
    const y = sampleIslandHeight(x, z)
    const pathDist = distanceToPath(x, z)
    const isPath = pathDist < 1.35 && y > -0.05
    const isSand = y <= 0.02 && (Math.hypot(x / 35.0, (z + 18.0) / 30.0) > 0.72)
    const nearBuilding = (
        Math.hypot(x - 4.5, z + 8.8) < 3.8 // Cottage
        || Math.hypot(x - 14.0, z + 22.0) < 3.6 // Overlook desk
        || Math.hypot(x + 6.0, z + 1.5) < 1.8 // Warp pipe
        || Math.hypot(x + 24.0, z + 35.0) < 4.5 // School wing
        || Math.hypot(x - 0.0, z + 44.0) < 3.5 // Bus stop
    )
    const isGrass = y > -0.02 && !isPath && !isSand && !nearBuilding
    return { y, isSand, isPath, isGrass }
}
