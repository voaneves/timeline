// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
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
    }

    // Assets are only requested through the manifest of THIS build (old JS -> old manifest -> old assets)
    getManifest()
    {
        if(!this.manifestPromise)
        {
            if(!BUILD_ID)
                return Promise.reject(new Error('Resources > no __BUILD_ID__, assets need a vite build + hash-assets'))
            this.manifestPromise = fetchManifest(BUILD_ID, document.baseURI)
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

            // Progress
            const progress = () =>
            {
                toLoad--

                if(typeof _progressCallback === 'function')
                    _progressCallback(toLoad, _files.length)
                
                if(toLoad === 0)
                    resolve(loadedResources)
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
                        undefined,
                        error
                    )
                }
            }
        })
    }
}