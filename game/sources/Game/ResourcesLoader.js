import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { fetchManifest, resolveAsset } from './assetManifest.js'

// Injected by vite.config.js (define); same id as asset-manifest.<buildId>.json (T0.15)
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null

export class ResourcesLoader
{
    constructor()
    {
        this.game = Game.getInstance()
        this.loaders = new Map()
        this.cache = new Map()
        this.manifestPromise = null

        this.criticalBytes = new Map()
        this.criticalSealed = false
        this.bytesLoaded = 0
        this.bytesTotal = 0
        this.pct = 0
        this.completedAtMs = null

        this.loaderEl = typeof document !== 'undefined' ? document.querySelector('.js-loader') : null
        this.pctEl = this.loaderEl?.querySelector('.js-loader-pct') || null
        this.exposeLoaderState()
    }

    exposeLoaderState()
    {
        if(typeof window === 'undefined')
            return
        window.__loader = {
            bytesLoaded: this.bytesLoaded,
            bytesTotal: this.bytesTotal,
            pct: this.pct,
            completedAtMs: this.completedAtMs,
        }
    }

    async prepareCritical(logicalNames = [])
    {
        const manifest = await this.getManifest()
        for(const name of logicalNames)
        {
            if(this.criticalBytes.has(name))
                continue
            const bytes = manifest?.assets?.[name]?.bytes ?? 0
            this.criticalBytes.set(name, {
                total: bytes,
                loaded: this.cache.has(name) ? bytes : 0,
            })
        }
        this.updateByteProgress()
        return manifest
    }

    updateByteProgress()
    {
        let loaded = 0
        let total = 0
        for(const entry of this.criticalBytes.values())
        {
            total += entry.total
            loaded += Math.min(entry.loaded, entry.total)
        }

        this.bytesLoaded = loaded
        this.bytesTotal = total
        this.pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0

        if(this.loaderEl)
        {
            const ratio = total > 0 ? Math.min(1, loaded / total) : 0
            this.loaderEl.style.setProperty('--loader-progress', String(ratio))
            if(this.pctEl)
                this.pctEl.textContent = `${this.pct}%`
        }

        if(total > 0 && loaded >= total && this.completedAtMs === null)
        {
            this.completedAtMs = Math.round(performance.now())
            this.loaderEl?.classList.add('is-complete')
        }

        this.exposeLoaderState()
    }

    finishCritical()
    {
        this.criticalSealed = true
        if(this.bytesTotal === 0)
        {
            this.pct = 100
            if(this.completedAtMs === null)
                this.completedAtMs = Math.round(performance.now())
            if(this.loaderEl)
            {
                this.loaderEl.style.setProperty('--loader-progress', '1')
                if(this.pctEl)
                    this.pctEl.textContent = '100%'
                this.loaderEl.classList.add('is-complete')
            }
            this.exposeLoaderState()
            return
        }

        for(const entry of this.criticalBytes.values())
            entry.loaded = entry.total
        this.updateByteProgress()
    }

    // Assets are only requested through the manifest of THIS build (same BUILD_ID as the JS), never a 'latest' one.
    // Whether an older build's files still exist depends on the deploy: published previews are an orphan single-commit
    // branch, so old hashed files do NOT persist there (a tab holding old JS can 404 after a new publish).
    // The promise is cached, but reset on failure (one automatic retry first) so a transient error is not permanent.
    getManifest()
    {
        if(!this.manifestPromise)
        {
            if(!BUILD_ID)
                return Promise.reject(new Error('Resources > no __BUILD_ID__, assets need a vite build + hash-assets'))

            const promise = fetchManifest(BUILD_ID, document.baseURI)
                .catch(() => fetchManifest(BUILD_ID, document.baseURI))
                .catch((error) =>
                {
                    if(this.manifestPromise === promise)
                        this.manifestPromise = null
                    throw error
                })
            this.manifestPromise = promise
        }
        return this.manifestPromise
    }

    getLoader(_type)
    {
        if(this.loaders.has(_type))
            return this.loaders.get(_type)

        let loader = null
        
        if(_type === 'texture')
        {
            loader = new THREE.TextureLoader()
        }
        else if(_type === 'gltf')
        {
            // No Draco / KTX2 (plan 6.5): meshopt only
            loader = new GLTFLoader()
            loader.setMeshoptDecoder(MeshoptDecoder)
        }

        this.loaders.set(_type, loader)

        return loader
    }

    load(_files, _progressCallback = null)
    {
        return this.getManifest().then(manifest => this.loadResolved(manifest, _files, _progressCallback))
    }

    // _file[1] is the logical name (path under static/), resolved to its hashed URL via the manifest
    loadResolved(_manifest, _files, _progressCallback)
    {
        return new Promise((resolve, reject) =>
        {
            let toLoad = _files.length
            const loadedResources = {}

            if(toLoad === 0)
            {
                resolve(loadedResources)
                return
            }

            // Register critical files for byte progress
            if(!this.criticalSealed)
            {
                for(const _file of _files)
                {
                    if(!this.criticalBytes.has(_file[1]))
                    {
                        const bytes = _manifest?.assets?.[_file[1]]?.bytes ?? 0
                        this.criticalBytes.set(_file[1], { total: bytes, loaded: 0 })
                    }
                }
                this.updateByteProgress()
            }

            // Progress
            const progress = () =>
            {
                toLoad--

                if(typeof _progressCallback === 'function')
                    _progressCallback(toLoad, _files.length)
                
                if(toLoad === 0)
                    resolve(loadedResources)
            }

            const markLoaded = (logicalName) =>
            {
                if(!this.criticalSealed && this.criticalBytes.has(logicalName))
                {
                    const entry = this.criticalBytes.get(logicalName)
                    entry.loaded = entry.total
                    this.updateByteProgress()
                }
            }

            const onFileProgress = (logicalName, event) =>
            {
                if(this.criticalSealed || !this.criticalBytes.has(logicalName) || !event)
                    return
                const entry = this.criticalBytes.get(logicalName)
                if(entry.total <= 0)
                    return
                let nextLoaded = entry.loaded
                if(event.lengthComputable && event.total > 0)
                    nextLoaded = Math.round(entry.total * (event.loaded / event.total))
                else if(event.loaded > 0)
                    nextLoaded = Math.min(entry.total, event.loaded)
                if(nextLoaded > entry.loaded)
                {
                    entry.loaded = Math.min(entry.total, nextLoaded)
                    this.updateByteProgress()
                }
            }

            // Save
            const save = (_file, _resource) =>
            {
                // Apply modifier
                if(typeof _file[3] !== 'undefined')
                    _file[3](_resource)
                    
                // Save in resources object
                loadedResources[_file[0]] = _resource

                // Save in cache
                this.cache.set(_file[1], _resource)
                markLoaded(_file[1])
            }

            // Error
            const error = (_file) =>
            {
                console.log(`Resources > Couldn't load file ${_file[1]}`)
                reject(_file[1])
            }

            // Each file
            for(const _file of _files)
            {
                // In cache
                if(this.cache.has(_file[1]))
                {
                    // Save cached file directly in resources object
                    loadedResources[_file[0]] = this.cache.get(_file[1])
                    markLoaded(_file[1])

                    progress()
                }

                // Not in cache
                else
                {
                    const loader = this.getLoader(_file[2])
                    loader.load(
                        resolveAsset(_manifest, _file[1], document.baseURI),
                        resource => {
                            save(_file, resource)
                            progress()
                        },
                        event => onFileProgress(_file[1], event),
                        () => error(_file)
                    )
                }
            }
        })
    }
}