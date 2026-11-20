import * as THREE from 'three/webgpu'

export class Debug
{
    static isRequested()
    {
        return !!(location.hash.match(/debug/i) || location.search.match(/[?&]debug(?:[=&]|$)/i))
    }

    // Value of `?debug=<value>` or `#debug=<value>` ('' for a bare flag, null when absent)
    static getParam(name)
    {
        const match = (location.search + '&' + location.hash.slice(1)).match(new RegExp('(?:^|[?&#])' + name + '(?:=([^&#]*))?(?:[&#]|$)', 'i'))
        return match ? (match[1] ?? '') : null
    }

    // Tweakpane is only fetched (separate chunk) when debug is requested.
    // Must be awaited before the first `new Debug()`.
    static async load()
    {
        // __DEBUG_PANEL__ is false in production: this block and its imports are removed from the bundle
        if(__DEBUG_PANEL__ && Debug.isRequested())
        {
            const [ tweakpane, essentials, camerakit ] = await Promise.all([
                import('tweakpane'),
                import('@tweakpane/plugin-essentials'),
                import('@tweakpane/plugin-camerakit'),
            ])

            Debug.modules = { Pane: tweakpane.Pane, EssentialsPlugin: essentials, CamerakitPlugin: camerakit }
        }
    }

    constructor()
    {
        this.active = Debug.isRequested() && !!Debug.modules

        if(this.active)
        {
            this.panel = new Debug.modules.Pane()
            this.panel.registerPlugin(Debug.modules.EssentialsPlugin)
            this.panel.registerPlugin(Debug.modules.CamerakitPlugin)

            addEventListener('keydown', (event) =>
            {
                if(event.code === 'KeyH')
                    this.panel.hidden = !this.panel.hidden
            })
        }
    }

    addManualBinding(panel, object, property, settings, update, manual = false)
    {
        const binding = {}
        binding.manual = manual
        binding.manualValue = object[property]
        binding.update = () =>
        {
            object[property] = binding.manual ? binding.manualValue : update()
        }

        if(this.active)
        {
            binding.instance = panel.addBinding(binding, 'manualValue', settings)
            binding.instance.on('change', () => { binding.manual = true })
            
            this.addButtons(
                panel,
                {
                    manual: () =>
                    {
                        binding.manual = true
                        binding.manualValue = object[property]
                        binding.instance.refresh()
                    },
                    auto: () =>
                    {
                        binding.manual = false
                        binding.update()
                        binding.manualValue = object[property]
                    }
                },
                ''
            )
        }

        return binding
    }

    addThreeColorBinding(panel, object, label)
    {
        return panel.addBinding({ color: object.getHex(THREE.SRGBColorSpace) }, 'color', { label: label, view: 'color' })
                    .on('change', tweak => { object.set(tweak.value) })
    }

    addButtons(panel, buttons, title = '')
    {
        const buttonKeys = Object.keys(buttons)

        panel
            .addBlade({
                view: 'buttongrid',
                size: [ buttonKeys.length, 1 ],
                cells: (x, y) => ({
                    title: [
                        buttonKeys,
                    ][y][x],
                }),
                label: title,
            })
            .on('click', (event) =>
            {
                buttons[event.cell.title](event.cell.title)
            })
    }
}