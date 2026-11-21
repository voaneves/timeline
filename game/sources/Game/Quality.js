import { Debug } from './Debug.js'
import { Events } from './Events.js'
import { Game } from './Game.js'

// Quality tiers: 0 = highest (Q0), 1 = reduced (Q1, mobile default), 2 = lowest (Q2, no bloom, scaled render resolution).
export const QUALITY_LEVELS = 3
const ADAPT_WINDOW_MS = 3000
const ADAPT_P90_THRESHOLD_MS = 18
const ADAPT_MIN_SAMPLES = 10

export class Quality
{
    constructor()
    {
        this.game = Game.getInstance()

        this.events = new Events()

        // `?q=0|1|2` forces a tier (overrides the UA detection); anything else is ignored
        this.forced = Quality.getForcedLevel()
        this.mode = this.forced !== null ? 'manual' : 'auto'

        this.level = this.forced !== null ? this.forced : (Quality.isMobile() ? 1 : 0) // 0 = highest quality

        // 3 s post-reveal auto-adaptation state (Q0 -> Q1 -> Q2 when p90 > 18 ms)
        this._samples = []
        this._windowMs = 0
        this.lastP90Ms = 0
        this.adaptationCount = 0
        this.syntheticFrameMs = Debug.getParam('qtest') === 'slow' ? 24 : null

        // Debug
        if(this.game.debug.active)
        {
            const debugPanel = this.game.debug.panel.addFolder({
                title: '⚙️ Quality',
                expanded: false,
            })

            this.game.debug.addButtons(
                debugPanel,
                {
                    lowest: () =>
                    {
                        this.setManualLevel(2)
                    },
                    low: () =>
                    {
                        this.setManualLevel(1)
                    },
                    high: () =>
                    {
                        this.setManualLevel(0)
                    },
                },
                'change'
            )
        }
    }

    static isMobile()
    {
        return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Boolean(navigator.userAgentData?.mobile)
    }

    // Value of `?q=` when it is exactly 0, 1 or 2, else null
    static getForcedLevel()
    {
        const value = Debug.getParam('q')
        return value !== null && /^[0-2]$/.test(value) ? Number(value) : null
    }

    injectSyntheticFrameMs(ms)
    {
        this.syntheticFrameMs = (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) ? ms : null
        this._samples.length = 0
        this._windowMs = 0
    }

    setManualLevel(levelOrNull)
    {
        this._samples.length = 0
        this._windowMs = 0

        if(levelOrNull === null || levelOrNull === undefined || levelOrNull === 'auto')
        {
            this.mode = this.forced !== null ? 'manual' : 'auto'
            const target = this.forced !== null ? this.forced : (Quality.isMobile() ? 1 : 0)
            this.changeLevel(target)
            return
        }

        const level = Number(levelOrNull)
        if(!Number.isInteger(level) || level < 0 || level >= QUALITY_LEVELS)
            return

        this.mode = 'manual'
        this.changeLevel(level)
    }

    recordFrame(dtMs)
    {
        if(this.mode !== 'auto' || this.forced !== null)
            return
        if(!this.game.ready || this.game.paused)
            return
        if(this.game.reveal && this.game.reveal.completedAtMs === null)
            return
        if(typeof document !== 'undefined' && document.hidden)
            return
        if(typeof dtMs !== 'number' || !Number.isFinite(dtMs) || dtMs <= 0)
            return

        const clampedDt = Math.min(dtMs, 250)
        const sampleMs = this.syntheticFrameMs !== null ? this.syntheticFrameMs : clampedDt
        this._samples.push(sampleMs)
        this._windowMs += clampedDt

        if(this._windowMs >= ADAPT_WINDOW_MS && this._samples.length >= ADAPT_MIN_SAMPLES)
        {
            const sorted = this._samples.slice().sort((a, b) => a - b)
            const idx = Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))
            const p90 = sorted[idx]
            this.lastP90Ms = p90
            this._samples.length = 0
            this._windowMs = 0

            if(p90 > ADAPT_P90_THRESHOLD_MS && this.level < QUALITY_LEVELS - 1)
            {
                this.adaptationCount++
                this.changeLevel(this.level + 1)
            }
        }
    }

    changeLevel(level = 0)
    {
        if(!Number.isInteger(level) || level < 0 || level >= QUALITY_LEVELS)
            return

        // Same
        if(level === this.level)
            return
            
        this.level = level
        this.events.trigger('change', [ this.level ])
    }
}