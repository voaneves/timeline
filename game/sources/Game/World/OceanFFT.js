// Adapted from dgreenheck/tidewater (MIT, (c) 2026 DRG Software Solutions LLC)
import * as THREE from 'three/webgpu'

const GRAVITY = 9.81
const TWO_PI = Math.PI * 2
export const FFT_SIZE = 64
export const DEFAULT_CASCADE_SIZES = [ 97, 29 ]

export class WaveSystem
{
    constructor(o = {})
    {
        this.scale = o.scale ?? 1
        this.windSpeed = o.windSpeed ?? 6.5
        this.windDirection = o.windDirection ?? 25
        this.fetch = o.fetch ?? 140
        this.spreadBlend = o.spreadBlend ?? 0.85
        this.swell = o.swell ?? 0.15
        this.peakEnhancement = o.peakEnhancement ?? 3.3
        this.shortWavesFade = o.shortWavesFade ?? 0.02
    }
}

function mulberry32(seed)
{
    let a = seed >>> 0
    return () =>
    {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function jonswapAlpha(fetchKm, windSpeed)
{
    const f = Math.max(1e-3, fetchKm * 1000)
    const u = Math.max(0.5, windSpeed)
    return 0.076 * Math.pow((u * u) / (f * GRAVITY), 0.22)
}

function jonswapPeakOmega(fetchKm, windSpeed)
{
    const f = Math.max(1e-3, fetchKm * 1000)
    const u = Math.max(0.5, windSpeed)
    return 22 * Math.pow((GRAVITY * GRAVITY) / (u * f), 1 / 3)
}

function jonswapSpectrum(omega, omegaP, alpha, gamma)
{
    if(omega <= 1e-4)
        return 0
    const sigma = omega <= omegaP ? 0.07 : 0.09
    const r = Math.exp(-((omega - omegaP) ** 2) / (2 * sigma * sigma * omegaP * omegaP))
    const pm = (alpha * GRAVITY * GRAVITY) / Math.pow(omega, 5) * Math.exp(-1.25 * Math.pow(omegaP / omega, 4))
    return pm * Math.pow(gamma, r)
}

/**
 * 2-cascade JONSWAP FFT ocean simulator (64x64 radix-2 IFFT) for WebGPU Q0,
 * packing (Dx, Dy, Dz, Jacobian foam) into a repeat RGBA8 DataTexture.
 */
export class OceanFFT
{
    constructor(options = {})
    {
        this.size = FFT_SIZE
        this.cascades = options.cascades ?? 2
        this.sizes = (options.sizes ?? DEFAULT_CASCADE_SIZES).slice(0, this.cascades)
        this.choppiness = options.choppiness ?? 0.85
        this.foamBias = options.foamBias ?? 0.68
        this.foamGain = options.foamGain ?? 2.4
        this.local = new WaveSystem(options.local)
        this.swell = new WaveSystem(options.swell ?? { scale: 0.42, windSpeed: 5.5, windDirection: 8, fetch: 600, swell: 0.8 })

        this.data = new Uint8Array(this.size * this.size * 4)
        this.displacementTexture = new THREE.DataTexture(
            this.data,
            this.size,
            this.size,
            THREE.RGBAFormat,
            THREE.UnsignedByteType
        )
        this.displacementTexture.wrapS = THREE.RepeatWrapping
        this.displacementTexture.wrapT = THREE.RepeatWrapping
        this.displacementTexture.minFilter = THREE.LinearFilter
        this.displacementTexture.magFilter = THREE.LinearFilter
        this.displacementTexture.needsUpdate = true

        this._buildSpectrum()
        this._allocateScratch()
    }

    _buildSpectrum()
    {
        const N = this.size
        const half = N >> 1
        const rand = mulberry32(20260412)
        const gauss = () =>
        {
            const u1 = Math.max(1e-6, rand())
            const u2 = rand()
            const r = Math.sqrt(-2 * Math.log(u1))
            return [ r * Math.cos(TWO_PI * u2), r * Math.sin(TWO_PI * u2) ]
        }

        const alphaL = jonswapAlpha(this.local.fetch, this.local.windSpeed)
        const omegaPL = jonswapPeakOmega(this.local.fetch, this.local.windSpeed)
        const windRadL = (this.local.windDirection * Math.PI) / 180

        this.h0 = []
        for(let c = 0; c < this.cascades; c++)
        {
            const L = this.sizes[c]
            const dk = TWO_PI / L
            const lowCut = c === 0 ? 0.0001 : (TWO_PI / this.sizes[c - 1]) * 1.15
            const highCut = (TWO_PI * half) / L

            const re = new Float32Array(N * N)
            const im = new Float32Array(N * N)
            const omegaArr = new Float32Array(N * N)
            const kxArr = new Float32Array(N * N)
            const kzArr = new Float32Array(N * N)

            for(let j = 0; j < N; j++)
            {
                const m = j - half
                const kz = m * dk
                for(let i = 0; i < N; i++)
                {
                    const n = i - half
                    const kx = n * dk
                    const k = Math.hypot(kx, kz)
                    const idx = j * N + i
                    kxArr[idx] = kx
                    kzArr[idx] = kz

                    if(k < lowCut || k > highCut || k < 1e-5)
                        continue

                    const omega = Math.sqrt(GRAVITY * k)
                    omegaArr[idx] = omega
                    const dOmega = (GRAVITY / (2 * omega)) * dk
                    const S = jonswapSpectrum(omega, omegaPL, alphaL, this.local.peakEnhancement)
                    const theta = Math.atan2(kz, kx) - windRadL
                    const dir = Math.max(0.05, Math.pow(Math.max(0, Math.cos(theta * 0.5)), 2))
                    const amp = Math.sqrt(2 * S * dir * (dk * dOmega) / k) * 0.55 * this.local.scale
                    const [ g0, g1 ] = gauss()
                    re[idx] = g0 * amp
                    im[idx] = g1 * amp
                }
            }
            this.h0.push({ re, im, omega: omegaArr, kx: kxArr, kz: kzArr })
        }
    }

    _allocateScratch()
    {
        const N = this.size
        const NN = N * N
        this.dyRe = new Float32Array(NN)
        this.dyIm = new Float32Array(NN)
        this.dxRe = new Float32Array(NN)
        this.dxIm = new Float32Array(NN)
        this.dzRe = new Float32Array(NN)
        this.dzIm = new Float32Array(NN)
        this.jxxRe = new Float32Array(NN)
        this.jxxIm = new Float32Array(NN)
        this.jzzRe = new Float32Array(NN)
        this.jzzIm = new Float32Array(NN)
        this.accDx = new Float32Array(NN)
        this.accDy = new Float32Array(NN)
        this.accDz = new Float32Array(NN)
        this.accJxx = new Float32Array(NN)
        this.accJzz = new Float32Array(NN)
        this.rowRe = new Float32Array(N)
        this.rowIm = new Float32Array(N)
    }

    _fft1D(re, im)
    {
        const N = this.size
        for(let i = 1, j = 0; i < N; i++)
        {
            let bit = N >> 1
            for(; j & bit; bit >>= 1)
                j ^= bit
            j ^= bit
            if(i < j)
            {
                let t = re[i]; re[i] = re[j]; re[j] = t
                t = im[i]; im[i] = im[j]; im[j] = t
            }
        }
        for(let len = 2; len <= N; len <<= 1)
        {
            const halfLen = len >> 1
            const ang = TWO_PI / len
            const wStepRe = Math.cos(ang)
            const wStepIm = Math.sin(ang)
            for(let i = 0; i < N; i += len)
            {
                let wRe = 1
                let wIm = 0
                for(let j = 0; j < halfLen; j++)
                {
                    const uIdx = i + j
                    const vIdx = uIdx + halfLen
                    const uRe = re[uIdx], uIm = im[uIdx]
                    const vRe = re[vIdx] * wRe - im[vIdx] * wIm
                    const vIm = re[vIdx] * wIm + im[vIdx] * wRe
                    re[uIdx] = uRe + vRe
                    im[uIdx] = uIm + vIm
                    re[vIdx] = uRe - vRe
                    im[vIdx] = uIm - vIm
                    const nwRe = wRe * wStepRe - wIm * wStepIm
                    wIm = wRe * wStepIm + wIm * wStepRe
                    wRe = nwRe
                }
            }
        }
    }

    _ifft2D(re, im)
    {
        const N = this.size
        const rowRe = this.rowRe
        const rowIm = this.rowIm
        for(let y = 0; y < N; y++)
        {
            const base = y * N
            for(let x = 0; x < N; x++)
            {
                rowRe[x] = re[base + x]
                rowIm[x] = im[base + x]
            }
            this._fft1D(rowRe, rowIm)
            for(let x = 0; x < N; x++)
            {
                re[base + x] = rowRe[x]
                im[base + x] = rowIm[x]
            }
        }
        for(let x = 0; x < N; x++)
        {
            for(let y = 0; y < N; y++)
            {
                const idx = y * N + x
                rowRe[y] = re[idx]
                rowIm[y] = im[idx]
            }
            this._fft1D(rowRe, rowIm)
            for(let y = 0; y < N; y++)
            {
                const idx = y * N + x
                const sign = ((x + y) & 1) ? -1 : 1
                re[idx] = rowRe[y] * sign
                im[idx] = rowIm[y] * sign
            }
        }
    }

    update(time)
    {
        const N = this.size
        const NN = N * N
        this.accDx.fill(0)
        this.accDy.fill(0)
        this.accDz.fill(0)
        this.accJxx.fill(0)
        this.accJzz.fill(0)

        for(let c = 0; c < this.cascades; c++)
        {
            const spec = this.h0[c]
            const weight = c === 0 ? 1.0 : 0.45
            for(let i = 0; i < NN; i++)
            {
                const w = spec.omega[i]
                if(w === 0)
                {
                    this.dyRe[i] = this.dyIm[i] = 0
                    this.dxRe[i] = this.dxIm[i] = 0
                    this.dzRe[i] = this.dzIm[i] = 0
                    this.jxxRe[i] = this.jxxIm[i] = 0
                    this.jzzRe[i] = this.jzzIm[i] = 0
                    continue
                }
                const cosWt = Math.cos(w * time)
                const sinWt = Math.sin(w * time)
                const hRe = spec.re[i] * cosWt - spec.im[i] * sinWt
                const hIm = spec.re[i] * sinWt + spec.im[i] * cosWt
                this.dyRe[i] = hRe
                this.dyIm[i] = hIm

                const kx = spec.kx[i]
                const kz = spec.kz[i]
                const k = Math.hypot(kx, kz) || 1
                const nx = kx / k
                const nz = kz / k
                this.dxRe[i] = hIm * nx
                this.dxIm[i] = -hRe * nx
                this.dzRe[i] = hIm * nz
                this.dzIm[i] = -hRe * nz
                this.jxxRe[i] = -hRe * (kx * nx)
                this.jxxIm[i] = -hIm * (kx * nx)
                this.jzzRe[i] = -hRe * (kz * nz)
                this.jzzIm[i] = -hIm * (kz * nz)
            }

            this._ifft2D(this.dyRe, this.dyIm)
            this._ifft2D(this.dxRe, this.dxIm)
            this._ifft2D(this.dzRe, this.dzIm)
            this._ifft2D(this.jxxRe, this.jxxIm)
            this._ifft2D(this.jzzRe, this.jzzIm)

            for(let i = 0; i < NN; i++)
            {
                this.accDy[i] += this.dyRe[i] * weight
                this.accDx[i] += this.dxRe[i] * this.choppiness * weight
                this.accDz[i] += this.dzRe[i] * this.choppiness * weight
                this.accJxx[i] += this.jxxRe[i] * this.choppiness * weight
                this.accJzz[i] += this.jzzRe[i] * this.choppiness * weight
            }
        }

        const out = this.data
        for(let i = 0; i < NN; i++)
        {
            const p = i * 4
            const dx = THREE.MathUtils.clamp(this.accDx[i] * 0.5 + 0.5, 0, 1)
            const dy = THREE.MathUtils.clamp(this.accDy[i] * 0.5 + 0.5, 0, 1)
            const dz = THREE.MathUtils.clamp(this.accDz[i] * 0.5 + 0.5, 0, 1)
            const jacobian = (1 + this.accJxx[i]) * (1 + this.accJzz[i])
            const foam = THREE.MathUtils.clamp((this.foamBias - jacobian) * this.foamGain, 0, 1)
            out[p] = Math.round(dx * 255)
            out[p + 1] = Math.round(dy * 255)
            out[p + 2] = Math.round(dz * 255)
            out[p + 3] = Math.round(foam * 255)
        }
        this.displacementTexture.needsUpdate = true
    }

    dispose()
    {
        this.displacementTexture?.dispose()
    }
}
