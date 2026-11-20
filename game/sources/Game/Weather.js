// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
// Minimal stub: upstream's Weather (rain/snow/wind/tornado cycles, 230 lines) is out of scope.
// Fixed values only, for future consumers (Wind, WaterSurface, Audio) that read `game.weather.*`.
import { uniform } from 'three/tsl'
import { Game } from './Game.js'

export class Weather
{
    constructor()
    {
        this.game = Game.getInstance()

        this.wind = { strength: uniform(0.3), direction: uniform(0) }
        this.temperature = uniform(0)
        this.rain = uniform(0)
        this.snow = uniform(0)
    }
}
