import * as THREE from 'three/webgpu'
import { Events } from './Events.js'
import dictionaries from '../data/i18n.js'

export class I18n
{
    static DEFAULT = 'pt-BR'
    static LANGS = [ 'pt-BR', 'en' ]
    static STORAGE_KEY = 'vn_lang'

    constructor()
    {
        this.events = new Events()
        this.lang = I18n.DEFAULT

        try
        {
            const stored = localStorage.getItem(I18n.STORAGE_KEY)
            if(I18n.LANGS.includes(stored))
                this.lang = stored
        }
        catch(e) {}

        this.apply()
    }

    t(key, params = {})
    {
        let value = dictionaries[this.lang]?.[key] ?? dictionaries[I18n.DEFAULT][key] ?? key

        for(const name in params)
            value = value.replaceAll(`{${name}}`, params[name])

        return value
    }

    // Picks the current language from a { 'pt-BR': '...', en: '...' } object
    pick(object)
    {
        if(typeof object === 'string')
            return object

        return object[this.lang] ?? object[I18n.DEFAULT]
    }

    applyToDOM(root = document)
    {
        for(const element of root.querySelectorAll('[data-i18n]'))
            element.textContent = this.t(element.dataset.i18n)

        for(const element of root.querySelectorAll('[data-i18n-html]'))
            element.innerHTML = this.t(element.dataset.i18nHtml, { revision: THREE.REVISION })

        for(const element of root.querySelectorAll('[data-i18n-placeholder]'))
            element.setAttribute('placeholder', this.t(element.dataset.i18nPlaceholder))
    }

    apply()
    {
        document.documentElement.lang = this.lang
        this.applyToDOM()
    }

    set(lang)
    {
        if(!I18n.LANGS.includes(lang) || lang === this.lang)
            return

        this.lang = lang

        try { localStorage.setItem(I18n.STORAGE_KEY, lang) }
        catch(e) {}

        this.apply()
        this.events.trigger('change', [ this.lang ])
    }

    toggle()
    {
        this.set(this.lang === 'pt-BR' ? 'en' : 'pt-BR')
    }
}
