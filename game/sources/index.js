// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
import './threejs-override.js'
import { Game } from './Game/Game.js'

// `?expose` (or VITE_GAME_PUBLIC) exposes the singleton as window.game for tests and measurements
if(import.meta.env.VITE_GAME_PUBLIC || location.search.match(/[?&]expose(?:[=&]|$)/i))
    window.game = new Game()
else
    new Game()
