// Pure manifest helpers (no imports, so they run in node tests). See scripts/hash-assets.mjs.
export const manifestUrl = (_buildId, _base) => new URL(`asset-manifest.${_buildId}.json`, _base).href

export async function fetchManifest(_buildId, _base, _fetch = fetch)
{
    const response = await _fetch(manifestUrl(_buildId, _base))
    if(!response.ok)
        throw new Error(`Asset manifest ${_buildId} not found (${response.status})`)
    return response.json()
}

// Logical name ('test/probe.glb') -> hashed URL. Throws if the manifest doesn't know it.
export function resolveAsset(_manifest, _name, _base)
{
    const entry = _manifest.assets[_name]
    if(!entry)
        throw new Error(`Asset "${_name}" is not in manifest ${_manifest.buildId}`)
    return new URL(entry.file, _base).href
}
