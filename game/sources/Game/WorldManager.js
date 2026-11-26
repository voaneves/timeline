import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { Events } from './Events.js'
import { Player } from './Player.js'

/**
 * Orquestra a transicao entre o mundo da superficie ('surface') e o mapa subaquatico ('underwater').
 * Preserva 100% do estado da ilha e alterna visibilidade + corpos Rapier + atmosfera sem reload.
 */
export class WorldManager
{
    constructor()
    {
        this.game = Game.getInstance()
        this.activeRealm = 'surface'
        this.isUnderwater = false
        this.transitioning = false
        this.events = new Events()

        this.savedSurfaceVisibility = []
        this.savedSurfaceBodies = []

        this.sounds = {
            dive: this.game.audio.register({
                path: 'sounds/swoosh/Swoosh 02.mp3',
                autoplay: false,
                loop: false,
                volume: 0.5
            }),
            surface: this.game.audio.register({
                path: 'sounds/reveal/reveal-1.mp3',
                autoplay: false,
                loop: false,
                volume: 0.45
            }),
        }

        // Botao rapido de retorno no HUD (visivel apenas em modo underwater)
        const surfaceBtn = document.querySelector('.js-surface-trigger')
        if(surfaceBtn)
        {
            surfaceBtn.addEventListener('click', (event) =>
            {
                event.preventDefault()
                if(this.isUnderwater)
                    this.exitUnderwater()
            })
        }
    }

    isVehicleOrCoreSceneChild(child)
    {
        if(!child)
            return true
        if(child === this.game.view.camera || child === this.game.view.defaultCamera || child === this.game.view.freeCamera || child === this.game.view.cameraHelper)
            return true
        if(child === this.game.lighting.light || child === this.game.lighting.light?.target)
            return true
        if(child === this.game.world?.visualVehicle?.parts?.chassis)
            return true
        if(child === this.game.world?.visualVehicle?.antenna?.head)
            return true
        if(child === this.game.world?.underwaterWorld?.group)
            return true
        if(child === this.game.world?.confetti?.mesh)
            return true
        if(child.userData?.keepInAllRealms)
            return true
        return false
    }

    enterUnderwater()
    {
        if(this.isUnderwater || this.transitioning)
            return
        if(!this.game.world?.underwaterWorld)
            return

        this.transitioning = true
        this.game.player.state = Player.STATE_LOCKED
        this.sounds.dive.play()

        this.game.overlay.show(() =>
        {
            const uw = this.game.world.underwaterWorld

            // 1. Salvar e ocultar objetos de superficie na cena
            this.savedSurfaceVisibility = []
            for(const child of this.game.scene.children)
            {
                if(this.isVehicleOrCoreSceneChild(child))
                    continue
                this.savedSurfaceVisibility.push([ child, child.visible ])
                child.visible = false
            }

            // 2. Salvar e desativar corpos Rapier da superficie
            const uwBodySet = new Set(uw.bodies)
            const vehicleBody = this.game.physicalVehicle.chassis.physical.body
            this.savedSurfaceBodies = []
            for(const phys of this.game.physics.physicals)
            {
                if(phys.body === vehicleBody || uwBodySet.has(phys.body))
                    continue
                const wasEnabled = phys.body.isEnabled()
                this.savedSurfaceBodies.push([ phys.body, wasEnabled ])
                if(wasEnabled)
                    phys.body.setEnabled(false)
            }

            // 3. Trocar reino ativo e ativar mundo underwater
            this.activeRealm = 'underwater'
            this.isUnderwater = true
            document.documentElement.classList.add('is-underwater')
            uw.setActive(true)

            // 4. Atmosfera subaquatica
            this.game.weather.override.start({
                humidity: 0,
                electricField: 0,
                clouds: 0,
                wind: 0.35
            }, 0)

            this.game.dayCycles.override.start({
                lightColor: new THREE.Color('#8beeff'),
                lightIntensity: 1.45,
                shadowColor: new THREE.Color('#0a3561'),
                fogColorA: new THREE.Color('#0c6e8c'),
                fogColorB: new THREE.Color('#052240'),
                fogNearRatio: -0.05,
                fogFarRatio: 0.92
            }, 0)

            // 5. Modo submarino + filtro de audio + ponto interativo + limpar rajadas de vento da superficie
            if(this.game.world?.windLines?.pool)
            {
                for(const wl of this.game.world.windLines.pool)
                    wl.mesh.visible = false
            }
            this.game.physicalVehicle.setUnderwaterMode(true)
            this.game.world.visualVehicle.setSubmarineMode(true)
            this.game.audio.setUnderwaterFilter(true)
            this.game.interactivePoints.syncRealmVisibility('underwater')

            // 6. Posicionar no Recife Subaquatico (limpo diante do farol)
            this.game.physicalVehicle.moveTo(new THREE.Vector3(0, 3.8, 13), Math.PI * 0.5)
            this.game.view.focusPoint.isTracking = true
            this.game.player.state = Player.STATE_DEFAULT

            this.game.achievements.setProgress('underwaterDive', 1)
            this.events.trigger('realmChange', [ 'underwater' ])

            this.game.overlay.hide(() =>
            {
                this.transitioning = false
            })
        })
    }

    exitUnderwater(targetRespawnName = null)
    {
        if(!this.isUnderwater || this.transitioning)
            return

        this.transitioning = true
        this.game.player.state = Player.STATE_LOCKED
        this.sounds.surface.play()

        this.game.overlay.show(() =>
        {
            const uw = this.game.world.underwaterWorld

            // 1. Desativar mundo underwater
            uw.setActive(false)
            this.activeRealm = 'surface'
            this.isUnderwater = false
            document.documentElement.classList.remove('is-underwater')

            // 2. Restaurar objetos de superficie e corpos Rapier
            for(const [ child, wasVisible ] of this.savedSurfaceVisibility)
                child.visible = wasVisible
            this.savedSurfaceVisibility = []

            for(const [ body, wasEnabled ] of this.savedSurfaceBodies)
            {
                if(wasEnabled)
                    body.setEnabled(true)
            }
            this.savedSurfaceBodies = []

            // 3. Restaurar atmosfera, veiculo e audio
            this.game.dayCycles.override.end(0)
            this.game.weather.override.end(0)
            this.game.physicalVehicle.setUnderwaterMode(false)
            this.game.world.visualVehicle.setSubmarineMode(false)
            this.game.audio.setUnderwaterFilter(false)
            this.game.interactivePoints.syncRealmVisibility('surface')

            // 4. Reposicionar na area escolhida ou faixa seca da praia Sudoeste
            if(targetRespawnName)
            {
                const respawn = this.game.respawns.getByName(targetRespawnName)
                if(respawn)
                    this.game.physicalVehicle.moveTo(respawn.position, respawn.rotation)
            }
            else
            {
                this.game.physicalVehicle.moveTo(new THREE.Vector3(-48, 2.5, 22), -0.6)
            }

            this.game.inputs.filters.clear()
            this.game.inputs.filters.add('wandering')
            this.game.view.focusPoint.isTracking = true
            this.game.player.state = Player.STATE_DEFAULT

            this.game.achievements.setProgress('underwaterReturn', 1)
            this.events.trigger('realmChange', [ 'surface' ])

            this.game.overlay.hide(() =>
            {
                this.transitioning = false
            })
        })
    }
}
