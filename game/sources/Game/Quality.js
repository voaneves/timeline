import { Debug } from './Debug.js'
import { Events } from './Events.js'
import { Game } from './Game.js'

// Quality tiers: 0 = highest, 1 = reduced (mobile default), 2 = lowest.
// Everything that reads `level` today branches on `level === 0` (high) vs everything else (reduced), so tier 2 is
// currently IDENTICAL to tier 1 (shadow map 512 / radius 2, 2 bloom mips, no cheap DOF, fixed camera phi 0.27, no speed zoom).
// Tier 2 will diverge in T2.29 (e.g. no bloom, smaller render scale / DPR cap); until then use `level > 0` as "reduced".
export const QUALITY_LEVELS = 3

export class Quality
{
    constructor()
    {
        this.game = Game.getInstance()

        this.events = new Events()

        // `?q=0|1|2` forces a tier (overrides the UA detection); anything else is ignored
        this.forced = Quality.getForcedLevel()

        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        this.level = this.forced !== null ? this.forced : (isMobile ? 1 : 0) // 0 = highest quality

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
                        this.changeLevel(2)
                    },
                    low: () =>
                    {
                        this.changeLevel(1)
                    },
                    high: () =>
                    {
                        this.changeLevel(0)
                    },
                },
                'change'
            )
        }
    }

    // Value of `?q=` when it is exactly 0, 1 or 2, else null
    static getForcedLevel()
    {
        const value = Debug.getParam('q')
        return value !== null && /^[0-2]$/.test(value) ? Number(value) : null
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