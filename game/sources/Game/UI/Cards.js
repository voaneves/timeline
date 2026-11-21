import contentData from '../../data/content.json'
import { Events } from '../Events.js'
import { Game } from '../Game.js'
import { Announcer } from './Announcer.js'

/**
 * Accessible `<dialog>` milestone, project, contact cards and "Lista de marcos" drawer.
 */
export class Cards
{
    constructor(announcer = null)
    {
        this.game = Game.getInstance()
        this.events = new Events()
        this.announcer = announcer || new Announcer(this.game?.domElement)

        this.content = contentData
        this.eras = this.content.eras || []
        this.projects = this.content.projects || []
        this.contact = this.content.contact || null

        this.milestones = []
        this.milestonesById = new Map()
        for(const era of this.eras)
        {
            for(const entry of era.entries || [])
            {
                const item = { ...entry, era }
                this.milestones.push(item)
                this.milestonesById.set(entry.id, item)
            }
        }

        this.projectsById = new Map(this.projects.map((p) => [ p.id, p ]))
        this.visited = new Set()
        this.activeCard = null
        this._restoreByPointer = false
        this._skipRestoreOnClose = false

        this.buildDialogs()
        this.bindEvents()
    }

    buildDialogs()
    {
        const root = this.game?.domElement || document.body

        // Card <dialog> (milestone / project / projects / contact)
        this.dialog = document.createElement('dialog')
        this.dialog.className = 'vn-dialog vn-card-dialog js-card-dialog'
        this.dialog.setAttribute('aria-labelledby', 'vn-card-title')
        this.dialog.innerHTML = `
            <article class="vn-card js-card-article">
                <header class="vn-card-header">
                    <span class="vn-card-badge js-card-badge"></span>
                    <button type="button" class="vn-btn vn-icon-btn js-card-close" aria-label="Fechar cartão">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>
                <div class="vn-card-content js-card-content"></div>
                <footer class="vn-card-footer">
                    <span class="vn-card-hint">Esc ou B para fechar</span>
                    <button type="button" class="vn-btn vn-btn-primary js-card-done">Fechar</button>
                </footer>
            </article>
        `
        root.appendChild(this.dialog)

        this.badgeEl = this.dialog.querySelector('.js-card-badge')
        this.contentEl = this.dialog.querySelector('.js-card-content')
        this.closeBtn = this.dialog.querySelector('.js-card-close')
        this.doneBtn = this.dialog.querySelector('.js-card-done')

        // "Lista de marcos" <dialog>
        this.listDialog = document.createElement('dialog')
        this.listDialog.className = 'vn-dialog vn-list-dialog js-list-dialog'
        this.listDialog.setAttribute('aria-labelledby', 'vn-list-title')
        this.listDialog.innerHTML = `
            <article class="vn-card vn-list-card">
                <header class="vn-card-header">
                    <h2 id="vn-list-title" class="vn-card-title" tabindex="-1">Lista de marcos</h2>
                    <button type="button" class="vn-btn vn-icon-btn js-list-close" aria-label="Fechar lista de marcos">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>
                <div class="vn-list-body js-list-body"></div>
            </article>
        `
        root.appendChild(this.listDialog)

        this.listHeadingEl = this.listDialog.querySelector('#vn-list-title')
        this.listBodyEl = this.listDialog.querySelector('.js-list-body')
        this.listCloseBtn = this.listDialog.querySelector('.js-list-close')
        this.renderListBody()
    }

    bindEvents()
    {
        this.closeBtn.addEventListener('click', (event) =>
        {
            this.close(event.detail > 0)
        })

        this.doneBtn.addEventListener('click', (event) =>
        {
            this.close(event.detail > 0)
        })

        this.dialog.addEventListener('click', (event) =>
        {
            if(event.target === this.dialog)
                this.close(true)
        })

        this.dialog.addEventListener('cancel', (event) =>
        {
            event.preventDefault()
            this.close(false)
        })

        this.dialog.addEventListener('close', () =>
        {
            const byPointer = this._restoreByPointer
            const skipRestore = this._skipRestoreOnClose
            this._restoreByPointer = false
            this._skipRestoreOnClose = false
            this.activeCard = null
            if(!skipRestore)
                this.restoreCanvasFocus(byPointer)
            this.events.trigger('close', [ 'card' ])
        })

        // List dialog events
        this.listCloseBtn.addEventListener('click', (event) =>
        {
            this.closeList(event.detail > 0)
        })

        this.listDialog.addEventListener('click', (event) =>
        {
            if(event.target === this.listDialog)
                this.closeList(true)
        })

        this.listDialog.addEventListener('cancel', (event) =>
        {
            event.preventDefault()
            this.closeList(false)
        })

        this.listDialog.addEventListener('close', () =>
        {
            const byPointer = this._restoreByPointer
            const skipRestore = this._skipRestoreOnClose
            this._restoreByPointer = false
            this._skipRestoreOnClose = false
            if(!skipRestore)
                this.restoreCanvasFocus(byPointer)
            this.events.trigger('close', [ 'list' ])
        })

        this.listBodyEl.addEventListener('click', (event) =>
        {
            const btn = event.target.closest('button[data-action]')
            if(!btn)
                return

            const action = btn.dataset.action
            const type = btn.dataset.type
            const id = btn.dataset.id
            const byPointer = event.detail > 0

            if(action === 'goto')
            {
                this.closeList(byPointer)
                this.triggerNavigate(type, id)
            }
            else if(action === 'open')
            {
                this._skipRestoreOnClose = true
                if(this.listDialog.open)
                    this.listDialog.close()

                if(type === 'milestone')
                    this.openMilestone(id)
                else if(type === 'project')
                    this.openProject(id)
                else if(type === 'contact')
                    this.openContact()
            }
        })

        // `B` closes an open card or list dialog
        window.addEventListener('keydown', (event) =>
        {
            if(event.code !== 'KeyB' || event.ctrlKey || event.metaKey || event.altKey)
                return

            if(this.dialog.open)
            {
                event.preventDefault()
                this.close(false)
            }
            else if(this.listDialog.open)
            {
                event.preventDefault()
                this.closeList(false)
            }
        })
    }

    isOpen()
    {
        return Boolean(this.dialog.open || this.listDialog.open)
    }

    releaseGameInputs()
    {
        this.game?.inputs?.keyboard?.releaseAll?.()
    }

    restoreCanvasFocus(byPointer = false)
    {
        const canvas = this.game?.canvasElement || document.querySelector('.js-canvas')
        if(!canvas)
            return

        const keyboard = this.game?.inputs?.keyboard
        if(byPointer)
        {
            if(keyboard)
                keyboard.keyboardFocusIntent = false
            canvas.classList.remove('is-keyboard-focus')
            canvas.focus({ preventScroll: true, focusVisible: false })
        }
        else
        {
            canvas.focus({ preventScroll: true })
        }
    }

    focusHeading(headingEl)
    {
        if(!headingEl)
            return
        headingEl.focus({ preventScroll: true })
    }

    findMilestone(id)
    {
        if(!id)
            return null
        if(this.milestonesById.has(id))
            return this.milestonesById.get(id)

        const norm = String(id)
        return this.milestones.find((m) =>
            m.id === norm ||
            m.datetime === norm ||
            m.datetime.startsWith(norm) ||
            m.id.startsWith(`e-${norm}`)
        ) || null
    }

    markVisited(milestone)
    {
        if(!milestone)
            return
        const isNew = !this.visited.has(milestone.id)
        this.visited.add(milestone.id)
        if(isNew)
        {
            this.renderListBody()
            this.events.trigger('visit', [ milestone, this.visited.size, this.milestones.length ])
        }
    }

    openMilestone(id)
    {
        const milestone = this.findMilestone(id)
        if(!milestone)
            return false

        this.closeOtherDialogs(this.dialog)
        this.releaseGameInputs()
        this.markVisited(milestone)

        this.badgeEl.textContent = `Era ${milestone.era.n} · ${milestone.era.name}`
        this.contentEl.replaceChildren()

        const time = document.createElement('time')
        time.className = 'vn-card-time'
        time.setAttribute('datetime', milestone.datetime)
        time.textContent = milestone.label

        const h2 = document.createElement('h2')
        h2.id = 'vn-card-title'
        h2.className = 'vn-card-title'
        h2.tabIndex = -1
        h2.textContent = milestone.title

        this.contentEl.append(time, h2)

        const bodyText = milestone.body || `${milestone.era.name} (${milestone.era.years})`
        const p = document.createElement('p')
        p.className = 'vn-card-body'
        p.textContent = bodyText
        this.contentEl.appendChild(p)

        this.activeCard = { type: 'milestone', id: milestone.id }
        if(!this.dialog.open)
            this.dialog.showModal()

        this.focusHeading(h2)
        this.announcer.announce(`${milestone.label}: ${milestone.title}`)
        this.events.trigger('open', [ 'milestone', milestone ])
        return true
    }

    openProject(id)
    {
        const project = this.projectsById.get(id) || this.projects[0]
        if(!project)
            return false

        this.closeOtherDialogs(this.dialog)
        this.releaseGameInputs()

        this.badgeEl.textContent = 'Projeto'
        this.contentEl.replaceChildren()

        const h2 = document.createElement('h2')
        h2.id = 'vn-card-title'
        h2.className = 'vn-card-title'
        h2.tabIndex = -1
        h2.textContent = project.title

        const p = document.createElement('p')
        p.className = 'vn-card-body'
        p.textContent = project.summary

        this.contentEl.append(h2, p)

        if(Array.isArray(project.stack) && project.stack.length > 0)
        {
            const ul = document.createElement('ul')
            ul.className = 'vn-card-stack'
            for(const tag of project.stack)
            {
                const li = document.createElement('li')
                li.className = 'vn-card-tag'
                li.textContent = tag
                ul.appendChild(li)
            }
            this.contentEl.appendChild(ul)
        }

        const links = this.createExternalLinks([
            project.live ? { label: 'Abrir projeto', href: project.live } : null,
            project.repo ? { label: 'Código no GitHub', href: project.repo } : null,
        ].filter(Boolean))
        if(links)
            this.contentEl.appendChild(links)

        this.activeCard = { type: 'project', id: project.id }
        if(!this.dialog.open)
            this.dialog.showModal()

        this.focusHeading(h2)
        this.announcer.announce(`Projeto: ${project.title}`)
        this.events.trigger('open', [ 'project', project ])
        return true
    }

    openProjects()
    {
        this.closeOtherDialogs(this.dialog)
        this.releaseGameInputs()

        this.badgeEl.textContent = `Projetos · ${this.projects.length}`
        this.contentEl.replaceChildren()

        const h2 = document.createElement('h2')
        h2.id = 'vn-card-title'
        h2.className = 'vn-card-title'
        h2.tabIndex = -1
        h2.textContent = 'Projetos em destaque'
        this.contentEl.appendChild(h2)

        const list = document.createElement('ul')
        list.className = 'vn-projects-summary'
        for(const project of this.projects)
        {
            const li = document.createElement('li')
            li.className = 'vn-projects-summary-item'

            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'vn-btn vn-btn-secondary vn-project-pick'
            btn.textContent = project.title
            btn.addEventListener('click', () => this.openProject(project.id))

            const summary = document.createElement('p')
            summary.className = 'vn-card-body'
            summary.textContent = project.summary

            li.append(btn, summary)
            list.appendChild(li)
        }
        this.contentEl.appendChild(list)

        this.activeCard = { type: 'projects', id: 'projects' }
        if(!this.dialog.open)
            this.dialog.showModal()

        this.focusHeading(h2)
        this.announcer.announce('Projetos em destaque')
        this.events.trigger('open', [ 'projects', this.projects ])
        return true
    }

    openContact()
    {
        if(!this.contact)
            return false

        this.closeOtherDialogs(this.dialog)
        this.releaseGameInputs()

        this.badgeEl.textContent = 'Contato'
        this.contentEl.replaceChildren()

        const h2 = document.createElement('h2')
        h2.id = 'vn-card-title'
        h2.className = 'vn-card-title'
        h2.tabIndex = -1
        h2.textContent = this.contact.title

        const p = document.createElement('p')
        p.className = 'vn-card-body'
        p.textContent = this.contact.text

        this.contentEl.append(h2, p)

        const links = this.createExternalLinks(this.contact.links || [])
        if(links)
            this.contentEl.appendChild(links)

        this.activeCard = { type: 'contact', id: this.contact.id }
        if(!this.dialog.open)
            this.dialog.showModal()

        this.focusHeading(h2)
        this.announcer.announce(`Contato: ${this.contact.title}`)
        this.events.trigger('open', [ 'contact', this.contact ])
        return true
    }

    openList()
    {
        this.closeOtherDialogs(this.listDialog)
        this.releaseGameInputs()
        this.renderListBody()

        if(!this.listDialog.open)
            this.listDialog.showModal()

        this.focusHeading(this.listHeadingEl)
        this.announcer.announce('Lista de marcos aberta')
        this.events.trigger('open', [ 'list', null ])
        return true
    }

    close(byPointer = false)
    {
        if(!this.dialog.open)
            return
        this._restoreByPointer = Boolean(byPointer)
        this.dialog.close()
        this.activeCard = null
        this.restoreCanvasFocus(this._restoreByPointer)
    }

    closeList(byPointer = false)
    {
        if(!this.listDialog.open)
            return
        this._restoreByPointer = Boolean(byPointer)
        this.listDialog.close()
        this.restoreCanvasFocus(this._restoreByPointer)
    }

    closeOtherDialogs(keep = null)
    {
        for(const d of document.querySelectorAll('dialog[open]'))
        {
            if(d === keep)
                continue
            if(d === this.dialog || d === this.listDialog)
                this._skipRestoreOnClose = true
            d.close()
        }
    }

    createExternalLinks(items)
    {
        if(!items.length)
            return null

        const ul = document.createElement('ul')
        ul.className = 'vn-card-links'
        for(const item of items)
        {
            let safeHref = null
            try
            {
                const parsed = new URL(item.href, location.href)
                if(parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:')
                    safeHref = parsed.href
            }
            catch {}
            if(!safeHref)
                continue

            const li = document.createElement('li')
            const a = document.createElement('a')
            a.className = 'vn-card-link'
            a.href = safeHref
            a.target = '_blank'
            a.rel = 'noopener noreferrer'
            a.textContent = item.label
            li.appendChild(a)
            ul.appendChild(li)
        }
        return ul
    }

    renderListBody()
    {
        this.listBodyEl.replaceChildren()

        for(const era of this.eras)
        {
            const section = document.createElement('section')
            section.className = 'vn-list-section'

            const h3 = document.createElement('h3')
            h3.className = 'vn-list-era-title'
            h3.textContent = `${era.n}. ${era.name} (${era.years})`
            section.appendChild(h3)

            const ul = document.createElement('ul')
            ul.className = 'vn-list-items'

            for(const entry of era.entries || [])
            {
                const li = document.createElement('li')
                li.className = 'vn-list-item'
                if(this.visited.has(entry.id))
                    li.classList.add('is-visited')

                const info = document.createElement('div')
                info.className = 'vn-list-item-info'

                const time = document.createElement('time')
                time.className = 'vn-list-item-time'
                time.setAttribute('datetime', entry.datetime)
                time.textContent = entry.label

                const title = document.createElement('span')
                title.className = 'vn-list-item-title'
                title.textContent = entry.title

                info.append(time, title)
                li.append(info, this.createItemActions('milestone', entry.id, entry.title))
                ul.appendChild(li)
            }

            section.appendChild(ul)
            this.listBodyEl.appendChild(section)
        }

        // Projects section
        const projSection = document.createElement('section')
        projSection.className = 'vn-list-section'
        const projH3 = document.createElement('h3')
        projH3.className = 'vn-list-era-title'
        projH3.textContent = 'Projetos'
        projSection.appendChild(projH3)

        const projUl = document.createElement('ul')
        projUl.className = 'vn-list-items'
        for(const project of this.projects)
        {
            const li = document.createElement('li')
            li.className = 'vn-list-item'

            const info = document.createElement('div')
            info.className = 'vn-list-item-info'
            const title = document.createElement('span')
            title.className = 'vn-list-item-title'
            title.textContent = project.title
            info.appendChild(title)

            li.append(info, this.createItemActions('project', project.id, project.title))
            projUl.appendChild(li)
        }
        projSection.appendChild(projUl)
        this.listBodyEl.appendChild(projSection)

        // Contact section
        if(this.contact)
        {
            const contactSection = document.createElement('section')
            contactSection.className = 'vn-list-section'
            const contactH3 = document.createElement('h3')
            contactH3.className = 'vn-list-era-title'
            contactH3.textContent = 'Contato'
            contactSection.appendChild(contactH3)

            const contactUl = document.createElement('ul')
            contactUl.className = 'vn-list-items'
            const li = document.createElement('li')
            li.className = 'vn-list-item'

            const info = document.createElement('div')
            info.className = 'vn-list-item-info'
            const title = document.createElement('span')
            title.className = 'vn-list-item-title'
            title.textContent = this.contact.title
            info.appendChild(title)

            li.append(info, this.createItemActions('contact', this.contact.id, this.contact.title))
            contactUl.appendChild(li)
            contactSection.appendChild(contactUl)
            this.listBodyEl.appendChild(contactSection)
        }
    }

    createItemActions(type, id, label)
    {
        const actions = document.createElement('div')
        actions.className = 'vn-list-item-actions'

        const gotoBtn = document.createElement('button')
        gotoBtn.type = 'button'
        gotoBtn.className = 'vn-btn vn-btn-secondary vn-list-action-btn'
        gotoBtn.dataset.action = 'goto'
        gotoBtn.dataset.type = type
        gotoBtn.dataset.id = id
        gotoBtn.setAttribute('aria-label', `Ir até ${label}`)
        gotoBtn.textContent = 'Ir até'

        const openBtn = document.createElement('button')
        openBtn.type = 'button'
        openBtn.className = 'vn-btn vn-btn-primary vn-list-action-btn'
        openBtn.dataset.action = 'open'
        openBtn.dataset.type = type
        openBtn.dataset.id = id
        openBtn.setAttribute('aria-label', `Abrir ${label}`)
        openBtn.textContent = 'Abrir'

        actions.append(gotoBtn, openBtn)
        return actions
    }

    triggerNavigate(type, id)
    {
        const detail = { type, id }
        this.announcer.announce('Navegando até o marco selecionado')
        this.events.trigger('navigate', [ detail ])
        window.dispatchEvent(new CustomEvent('timeline:navigate', { detail }))
    }
}
