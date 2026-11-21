// Flat unlit 16x16 palette calibration view (`?debug=palette`, plan T2.2).
// Exercises the real WebGPU/WebGL2 RenderPipeline (SRGBColorSpace + renderer.toneMapping)
// with bloom and cheapDOF disabled so every swatch can be measured with CIEDE2000.
import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { Game } from '../Game.js'
import paletteData from '../../../blender/palette/palette.json'

const BOARD_DISTANCE = 10
const BOARD_COVERAGE = 0.84
const QUAD_FILL = 0.86

const TONE_MAPPING_NAMES = {
    [THREE.NoToneMapping]: 'NoToneMapping',
    [THREE.LinearToneMapping]: 'LinearToneMapping',
    [THREE.ReinhardToneMapping]: 'ReinhardToneMapping',
    [THREE.CineonToneMapping]: 'CineonToneMapping',
    [THREE.ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
    [THREE.AgXToneMapping]: 'AgXToneMapping',
    [THREE.NeutralToneMapping]: 'NeutralToneMapping',
}

export class PaletteCalibration
{
    constructor()
    {
        this.game = Game.getInstance()
        this.size = paletteData.size ?? 16
        this.swatches = paletteData.swatches
        this.ready = this.init()
    }

    async init()
    {
        // Load palette.png through the hashed asset manifest
        const resources = await this.game.resourcesLoader.load([
            [ 'palette', 'palette.png', 'texture' ],
        ])

        this.paletteTexture = resources.palette
        this.paletteTexture.colorSpace = THREE.SRGBColorSpace
        this.paletteTexture.minFilter = THREE.NearestFilter
        this.paletteTexture.magFilter = THREE.NearestFilter
        this.paletteTexture.generateMipmaps = false
        // glTF 2.0 top-left UV convention: row 0 = top of PNG -> v = (row + 0.5) / 16
        this.paletteTexture.flipY = false
        this.paletteTexture.needsUpdate = true

        this.configurePipeline()
        this.createBoard()
        this.updateLayout()
        this.exposeCalibration()

        this.game.viewport.events.on('change', () =>
        {
            this.updateLayout()
            this.exposeCalibration()
        })

        this.game.ticker.events.on('tick', () =>
        {
            this.updateLayout()
        }, 900)
    }

    configurePipeline()
    {
        this.game.scene.backgroundNode = null
        this.game.scene.background = new THREE.Color('#181818')

        if(this.game.view?.speedLines?.mesh)
            this.game.view.speedLines.mesh.visible = false

        if(this.game.rendering?.bloomPass)
            this.game.rendering.bloomPass.strength.value = 0

        if(this.game.rendering?.cheapDOFPass)
            this.game.rendering.cheapDOFPass.amount.value = 0

        if(this.game.debug?.panel)
            this.game.debug.panel.hidden = true
    }

    createBoard()
    {
        const size = this.size
        const cellCount = size * size
        const positions = new Float32Array(cellCount * 6 * 3)
        const uvs = new Float32Array(cellCount * 6 * 2)

        const cellSize = 1 / size
        const halfQuad = (cellSize * QUAD_FILL) * 0.5

        let pOffset = 0
        let uvOffset = 0

        for(let row = 0; row < size; row++)
        {
            const cy = 0.5 - (row + 0.5) / size
            const v = (row + 0.5) / size

            for(let col = 0; col < size; col++)
            {
                const cx = (col + 0.5) / size - 0.5
                const u = (col + 0.5) / size

                const x0 = cx - halfQuad
                const x1 = cx + halfQuad
                const y0 = cy - halfQuad
                const y1 = cy + halfQuad

                // Triangle 1: BL, BR, TR
                positions[pOffset++] = x0; positions[pOffset++] = y0; positions[pOffset++] = 0
                positions[pOffset++] = x1; positions[pOffset++] = y0; positions[pOffset++] = 0
                positions[pOffset++] = x1; positions[pOffset++] = y1; positions[pOffset++] = 0

                // Triangle 2: BL, TR, TL
                positions[pOffset++] = x0; positions[pOffset++] = y0; positions[pOffset++] = 0
                positions[pOffset++] = x1; positions[pOffset++] = y1; positions[pOffset++] = 0
                positions[pOffset++] = x0; positions[pOffset++] = y1; positions[pOffset++] = 0

                for(let i = 0; i < 6; i++)
                {
                    uvs[uvOffset++] = u
                    uvs[uvOffset++] = v
                }
            }
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

        const material = new THREE.MeshBasicNodeMaterial({
            fog: false,
            depthTest: false,
            depthWrite: false,
        })
        material.colorNode = texture(this.paletteTexture)

        this.mesh = new THREE.Mesh(geometry, material)
        this.mesh.name = 'paletteCalibrationBoard'
        this.mesh.position.set(0, 0, -BOARD_DISTANCE)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 999

        this.game.view.camera.add(this.mesh)
    }

    updateLayout()
    {
        const camera = this.game.view.camera
        const viewHeight = 2 * BOARD_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
        const viewWidth = viewHeight * camera.aspect
        const boardWorldSize = Math.min(viewWidth, viewHeight) * BOARD_COVERAGE

        this.mesh.scale.set(boardWorldSize, boardWorldSize, 1)
    }

    computeSampleRects()
    {
        const width = this.game.viewport.width
        const height = this.game.viewport.height
        const size = this.size
        const boardPx = Math.min(width, height) * BOARD_COVERAGE
        const quadPx = (boardPx / size) * QUAD_FILL

        const rects = {}
        for(const [ name, spec ] of Object.entries(this.swatches))
        {
            const centerX = width * 0.5 + ((spec.col + 0.5) / size - 0.5) * boardPx
            const centerY = height * 0.5 + ((spec.row + 0.5) / size - 0.5) * boardPx
            rects[name] = {
                name,
                col: spec.col,
                row: spec.row,
                hex: spec.hex,
                group: spec.group,
                x: centerX - quadPx * 0.5,
                y: centerY - quadPx * 0.5,
                width: quadPx,
                height: quadPx,
                centerX,
                centerY,
            }
        }
        return rects
    }

    exposeCalibration()
    {
        const renderer = this.game.rendering.renderer
        const toneMappingName = TONE_MAPPING_NAMES[renderer.toneMapping] ?? String(renderer.toneMapping)

        window.__paletteCalibration = {
            ready: true,
            gridSize: this.size,
            uvConvention: paletteData.uvConvention,
            backend: this.game.rendering.backendName,
            toneMapping: toneMappingName,
            toneMappingValue: renderer.toneMapping,
            toneMappingExposure: renderer.toneMappingExposure,
            outputColorSpace: renderer.outputColorSpace,
            swatches: this.swatches,
            sampleRects: this.computeSampleRects(),
        }
    }
}
