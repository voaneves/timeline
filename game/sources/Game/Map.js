import { clamp } from 'three/src/math/MathUtils.js'
import { Game } from './Game.js'

export class Map
{
    constructor()
    {
        this.game = Game.getInstance()

        this.initiated = false
        this.modal = this.game.modals.items.get('map')
        this.element = this.modal.element.querySelector('.js-map-container')

        this.setTrigger()
        this.setInputs()

        this.setDiscovery()

        this.modal.events.on('open', () =>
        {
            if(!this.initiated)
                this.init()

            this.texture.update()
            this.updateProgress()
        })
    }

    // Micro-notification when an area is discovered for the first time
    setDiscovery()
    {
        this.game.achievements.events.on('areaDiscovered', (id) =>
        {
            // Spawn inicial: nao e uma descoberta
            if(id === 'landing')
                return

            const key = `map.${id}`
            const name = this.game.i18n.t(key).replace(/<br\s*\/?>\s*/g, '')

            this.game.notifications.show(
                /* html */`<div class="discovery">${this.game.i18n.t('map.discoveredToast', { name })}</div>`,
                'discovery',
                2.5,
                null,
                `area-${id}`
            )

            if(this.initiated)
                this.updateProgress()
        })
    }

    init()
    {
        this.initiated = true
        
        this.setLocations()
        this.setPlayer()
        this.setTexture()
        this.setProgress()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 14)
    }

    setLocations()
    {
        this.locations = {}
        this.locations.items = [
            { key: 'map.achievements', respawnName: 'achievements', offset: { x: 0, y: -0.01 } },
            { key: 'map.altar', respawnName: 'altar', offset: { x: 0, y: -0.05 } },
            { key: 'map.behindTheScene', respawnName: 'behindTheScene', offset: { x: 0.01, y: 0 } },
            { key: 'map.bowling', respawnName: 'bowling', offset: { x: -0.08, y: 0.03 } },
            { key: 'map.career', respawnName: 'career', offset: { x: 0, y: -0.06 } },
            { key: 'map.circuit', respawnName: 'circuit', offset: { x: -0.08, y: -0.05 } },
            { key: 'map.cookie', respawnName: 'cookie', offset: { x: -0.02, y: -0.01 } },
            { key: 'map.lab', respawnName: 'lab', offset: { x: -0.03, y: 0 } },
            { key: 'map.landing', respawnName: 'landing', offset: { x: 0.02, y: 0 } },
            { key: 'map.projects', respawnName: 'projects', offset: { x: 0, y: -0.02 } },
            { key: 'map.social', respawnName: 'social', offset: { x: -0.01, y: -0.04 } },
            { key: 'map.timeMachine', respawnName: 'timeMachine', offset: { x: 0, y: 0 } },
        ]

        for(const item of this.locations.items)
        {
            const respawn = this.game.respawns.getByName(item.respawnName)
            const mapPosition = this.worldToMap(respawn.position)

            // HTML
            const html = /* html */`
                <div class="pin"></div>
                <div class="name-container">
                    <div class="name">${this.game.i18n.t(item.key)}</div>
                </div>
            `

            const element = document.createElement('div')
            element.classList.add('location')
            element.innerHTML = html
            element.style.left = `${(mapPosition.x + item.offset.x)* 100}%`
            element.style.top = `${(mapPosition.y + item.offset.y)* 100}%`
            element.style.zIndex = Math.round(mapPosition.y * 1000)
            
            this.element.append(element)
            item.element = element

            const nameElement = element.querySelector('.name')
            this.game.i18n.events.on('change', () =>
            {
                nameElement.innerHTML = this.game.i18n.t(item.key)
            })

            element.addEventListener('click', () =>
            {
                this.game.player.respawn(item.respawnName, () =>
                {
                    this.game.view.focusPoint.isTracking = true
                })
                this.game.modals.close()
            })
        }
    }
    
    setProgress()
    {
        this.progress = {}
        this.progress.element = document.createElement('div')
        this.progress.element.classList.add('discovered')
        this.element.append(this.progress.element)

        this.game.i18n.events.on('change', () =>
        {
            this.updateProgress()
        })

        this.updateProgress()
    }

    updateProgress()
    {
        const group = this.game.achievements.groups.get('areas')
        const visited = group && group.progress instanceof Set ? group.progress : new Set()
        // Conquista conta 13 areas (inclui a cabine escondida, sem pin); o mapa mostra so as com pin
        const count = this.locations.items.filter(item => visited.has(item.respawnName)).length

        this.progress.element.textContent = this.game.i18n.t('map.discovered', { count, total: this.locations.items.length })

        for(const item of this.locations.items)
            item.element.classList.toggle('is-visited', visited.has(item.respawnName))
    }

    setPlayer()
    {
        this.player = {}
        this.player.element = this.element.querySelector('.js-player')
        this.player.roundedPosition = { x: 0, y: 0 }
    }
    
    setTexture()
    {
        this.texture = {}
        this.texture.element = this.element.querySelector('.js-texture')
        this.texture.previousUrl = null

        this.texture.element.addEventListener('load', () =>
        {
            this.texture.element.classList.add('is-visible')
        })
        
        this.texture.update = () =>
        {
            const url = this.game.dayCycles.intervalEvents.get('night').inInterval ? 'ui/map/map-night.webp' : 'ui/map/map-day.webp'

            if(url !== this.texture.previousUrl)
            {
                this.texture.element.classList.remove('is-visible')
                this.texture.previousUrl = url
                this.texture.element.src = url
            }
        }
    }

    setTrigger()
    {
        const element = this.game.domElement.querySelector('.js-map-trigger')
        
        element.addEventListener('click', (event) =>
        {
            // Teleporting out of a running circuit race would leave it in an inconsistent state
            const circuitState = this.game.world.areas?.circuit?.state
            if(circuitState === 2 || circuitState === 3 || circuitState === 4) // STARTING, RUNNING, ENDING
                return

            this.game.modals.open('map')
        })
        element.addEventListener('keydown', (event) =>
        {
            event.preventDefault()
        })
    }

    setInputs()
    {
        // Inputs keyboard
        this.game.inputs.addActions([
            { name: 'map', categories: [ 'modal', 'menu', 'wandering' ], keys: [ 'Keyboard.m', 'Keyboard.KeyM' ] },
        ])
        this.game.inputs.events.on('map', (action) =>
        {
            if(action.active)
            {
                if(!this.modal.isOpen)
                    this.game.modals.open('map')
                else
                    this.game.modals.close()
            }
        })
    }

    worldToMap(coordinates)
    {
        let x = coordinates.x
        let y = typeof coordinates.z !== 'undefined' ? coordinates.z : coordinates.y

        x /= this.game.terrain.size
        y /= this.game.terrain.size

        x += 0.5
        y += 0.5

        x = clamp(x, 0, 1)
        y = clamp(y, 0, 1)

        return { x, y }
    }

    update()
    {
        if(!this.modal.isOpen)
            return

        const playerRoundedX = Math.round(this.game.player.position.x)
        const playerRoundedY = Math.round(this.game.player.position.z)

        if(playerRoundedX !== this.player.roundedPosition.x || playerRoundedY !== this.player.roundedPosition.y)
        {
            this.player.roundedPosition.x = playerRoundedX
            this.player.roundedPosition.y = playerRoundedY

            const playerCoordinates = this.worldToMap(this.player.roundedPosition)
            const x = Math.round(playerCoordinates.x * 1000) / 10
            const y = Math.round(playerCoordinates.y * 1000) / 10

            this.player.element.style.left = `${x}%`
            this.player.element.style.top = `${y}%`
            this.player.element.style.transform = `rotate(${-this.game.physicalVehicle.yRotation}rad)`
        }
    }
}