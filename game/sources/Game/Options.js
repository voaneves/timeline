import { Game } from './Game.js'

export class Options
{
    constructor()
    {
        this.game = Game.getInstance()
        this.element = this.game.menu.items.get('options').contentElement

        this.setLanguage()
        this.setSound()
        this.setQuality()
        this.setRespawn()
        this.setReset()
        this.setRenderer()
        this.setServer()
    }

    setLanguage()
    {
        const element = this.element.querySelector('.js-language-toggle')
        const text = element.querySelector('span')

        const update = () =>
        {
            text.textContent = this.game.i18n.lang === 'pt-BR' ? 'PT-BR' : 'EN'
        }
        update()

        element.addEventListener('click', () =>
        {
            this.game.i18n.toggle()
        })

        this.game.i18n.events.on('change', update)
    }

    setSound()
    {
        const element = this.element.querySelector('.js-audio-toggle')

        element.addEventListener('click', this.game.audio.mute.toggle)
    }

    setQuality()
    {
        const element = this.element.querySelector('.js-quality-toggle')
        const text = element.querySelector('span')
        const update = () =>
        {
            text.textContent = this.game.i18n.t(this.game.quality.level === 0 ? 'options.quality.high' : 'options.quality.low')
        }
        update()

        element.addEventListener('click', () =>
        {
            this.game.quality.changeLevel(this.game.quality.level === 0 ? 1 : 0)
        })

        this.game.quality.events.on('change', update)
        this.game.i18n.events.on('change', update)
    }

    setRespawn()
    {
        const element = this.element.querySelector('.js-respawn')

        element.addEventListener('click', () =>
        {
            this.game.player.respawn()
            this.game.menu.close()
        })
    }

    setReset()
    {
        const element = this.element.querySelector('.js-reset')

        element.addEventListener('click', () =>
        {
            this.game.reset()
            this.game.menu.close()
        })
    }

    setRenderer()
    {        
        if(this.game.rendering.renderer.backend.isWebGLBackend)
        {
            const element = this.element.querySelector('.js-renderer')
            element.classList.remove('is-success')
            element.classList.add('is-danger')

            const text = element.querySelector('span')
            text.textContent = 'WebGL'

            const tooltip = element.querySelector('.js-tooltip')
            tooltip.removeAttribute('data-i18n')
            const updateTooltip = () =>
            {
                tooltip.innerHTML = this.game.i18n.t('options.renderer.webgl.tip')
            }
            updateTooltip()
            this.game.i18n.events.on('change', updateTooltip)
        }
    }

    setServer()
    {
        const element = this.element.querySelector('.js-server')
        const text = element.querySelector('span')
        const tooltip = element.querySelector('.js-tooltip')
        text.removeAttribute('data-i18n')
        
        const update = (connected) =>
        {
            if(connected)
            {
                element.classList.add('is-success')
                element.classList.remove('is-danger')
                
                text.textContent = this.game.i18n.t('options.server.online')

                tooltip.innerHTML = this.game.i18n.t('options.server.online.tip')
            }
            else
            {
                element.classList.remove('is-success')
                element.classList.add('is-danger')
                text.textContent = this.game.i18n.t('options.server.offline')

                tooltip.innerHTML = this.game.i18n.t('options.server.offline.tip')
            }
        }

        update(this.game.server.connected)
        this.game.i18n.events.on('change', () => update(this.game.server.connected))

        this.game.server.events.on('connected', () =>
        {
            update(true)
        })
        this.game.server.events.on('disconnected', () =>
        {
            update(false)
        })
    }
}