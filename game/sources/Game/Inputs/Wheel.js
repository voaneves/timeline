// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
// Change: no `normalize-wheel` dependency (unmaintained, BSD-3). One notch ≈ 1 unit (deltaY 100 px).
import { Events } from '../Events.js'

const LINE_HEIGHT = 40
const PAGE_HEIGHT = 800
const NOTCH = 100

export class Wheel
{
    constructor()
    {
        this.events = new Events()

        addEventListener('wheel', (_event) =>
        {
            let delta = _event.shiftKey ? _event.deltaX : _event.deltaY

            if(_event.deltaMode === 1)
                delta *= LINE_HEIGHT
            else if(_event.deltaMode === 2)
                delta *= PAGE_HEIGHT

            this.events.trigger('roll', [ delta / NOTCH ])
        }, { passive: true })
    }
}
