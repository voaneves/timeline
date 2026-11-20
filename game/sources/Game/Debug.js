// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
import * as THREE from 'three/webgpu'

export class Debug
{
    static isRequested()
    {
        return !!(location.hash.match(/debug/i) || location.search.match(/[?&]debug/i))
    }

    // Tweakpane is only fetched (separate chunk) when debug is requested.
    // Must be awaited before the first `new Debug()`.
    static async load()
    {
        if(!Debug.isRequested())
            return

        const [ tweakpane, essentials, camerakit ] = await Promise.all([
            import('tweakpane'),
            import('@tweakpane/plugin-essentials'),
            import('@tweakpane/plugin-camerakit'),
        ])

        Debug.modules = { Pane: tweakpane.Pane, EssentialsPlugin: essentials, CamerakitPlugin: camerakit }
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