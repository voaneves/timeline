import { Howler } from 'howler'

const STORAGE_KEY = 'vn_park_records_v1'
const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 }
const MEDAL_ICON = { none: '🎯', bronze: '🥉', silver: '🥈', gold: '🏆' }

export class ParkArcadeHud
{
    constructor(game, handlers = {})
    {
        this.game = game
        this.onAbort = handlers.onAbort || (() => {})
        this.onReplay = handlers.onReplay || (() => {})
        this.onTimingHit = handlers.onTimingHit || (() => {})

        this.records = this.loadRecords()
        this.resultTimer = null
        this.toastTimer = null
        this.lastCountdownText = null

        this.buildDom()
    }

    loadRecords()
    {
        try
        {
            const raw = localStorage.getItem(STORAGE_KEY)
            return raw ? JSON.parse(raw) : {}
        }
        catch(e)
        {
            return {}
        }
    }

    getRecord(id)
    {
        return this.records[id] || { bestScore: 0, medal: 'none' }
    }

    saveRecord(id, score, medal)
    {
        const prev = this.getRecord(id)
        const isNewBest = score > prev.bestScore
        const bestScore = Math.max(prev.bestScore, score)
        const bestMedal = (MEDAL_RANK[medal] || 0) >= (MEDAL_RANK[prev.medal] || 0) ? medal : prev.medal
        this.records[id] = { bestScore, medal: bestMedal }
        try
        {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records))
        }
        catch(e) {}
        return { isNewBest, bestScore, bestMedal }
    }

    buildDom()
    {
        // HUD lateral superior esquerdo
        this.root = document.createElement('div')
        this.root.className = 'park-arcade-hud'
        this.root.innerHTML = /* html */`
            <div class="park-hud-top">
                <div class="park-hud-title-wrap">
                    <span class="park-hud-icon"></span>
                    <span class="park-hud-title"></span>
                </div>
                <button type="button" class="park-exit-btn"></button>
            </div>
            <div class="park-hud-stats">
                <div class="park-stat">
                    <span class="park-stat-label park-lbl-time"></span>
                    <span class="park-stat-val park-timer">--</span>
                </div>
                <div class="park-stat">
                    <span class="park-stat-label park-lbl-score"></span>
                    <span class="park-stat-val park-score">0</span>
                </div>
                <div class="park-stat">
                    <span class="park-stat-label park-lbl-combo"></span>
                    <span class="park-stat-val park-combo">x1</span>
                </div>
                <div class="park-stat">
                    <span class="park-stat-label park-lbl-best"></span>
                    <span class="park-stat-val park-best">--</span>
                </div>
            </div>
            <div class="park-hud-hint"></div>
            <div class="park-timing-wrap">
                <div class="park-timing-bar">
                    <div class="zone-good"></div>
                    <div class="zone-perfect"></div>
                    <div class="needle"></div>
                </div>
                <div class="park-timing-caption"></div>
            </div>
        `
        document.body.appendChild(this.root)

        this.el = {
            icon: this.root.querySelector('.park-hud-icon'),
            title: this.root.querySelector('.park-hud-title'),
            exitBtn: this.root.querySelector('.park-exit-btn'),
            lblTime: this.root.querySelector('.park-lbl-time'),
            lblScore: this.root.querySelector('.park-lbl-score'),
            lblCombo: this.root.querySelector('.park-lbl-combo'),
            lblBest: this.root.querySelector('.park-lbl-best'),
            timer: this.root.querySelector('.park-timer'),
            score: this.root.querySelector('.park-score'),
            combo: this.root.querySelector('.park-combo'),
            best: this.root.querySelector('.park-best'),
            hint: this.root.querySelector('.park-hud-hint'),
            timingWrap: this.root.querySelector('.park-timing-wrap'),
            timingBar: this.root.querySelector('.park-timing-bar'),
            zoneGood: this.root.querySelector('.zone-good'),
            zonePerfect: this.root.querySelector('.zone-perfect'),
            needle: this.root.querySelector('.needle'),
            timingCaption: this.root.querySelector('.park-timing-caption'),
        }

        this.el.exitBtn.addEventListener('click', (e) =>
        {
            e.stopPropagation()
            this.onAbort()
        })
        this.el.timingBar.addEventListener('pointerdown', (e) =>
        {
            e.stopPropagation()
            this.onTimingHit()
        })

        // Contagem regressiva 3-2-1-VAI!
        this.countdownEl = document.createElement('div')
        this.countdownEl.className = 'park-countdown'
        document.body.appendChild(this.countdownEl)

        // Toast flutuante de combo/evento
        this.toastEl = document.createElement('div')
        this.toastEl.className = 'park-toast'
        document.body.appendChild(this.toastEl)

        // Card de resultado final
        this.resultEl = document.createElement('div')
        this.resultEl.className = 'park-result-card'
        this.resultEl.innerHTML = /* html */`
            <div class="park-res-medal"></div>
            <div class="park-res-body">
                <div class="park-res-top">
                    <span class="park-res-title"></span>
                    <span class="park-res-badge"></span>
                </div>
                <div class="park-res-score"></div>
                <div class="park-res-meta"></div>
            </div>
            <div class="park-res-actions">
                <button type="button" class="park-res-btn is-primary park-btn-replay"></button>
                <button type="button" class="park-res-btn park-btn-close"></button>
            </div>
        `
        document.body.appendChild(this.resultEl)

        this.resEl = {
            medal: this.resultEl.querySelector('.park-res-medal'),
            title: this.resultEl.querySelector('.park-res-title'),
            badge: this.resultEl.querySelector('.park-res-badge'),
            score: this.resultEl.querySelector('.park-res-score'),
            meta: this.resultEl.querySelector('.park-res-meta'),
            replayBtn: this.resultEl.querySelector('.park-btn-replay'),
            closeBtn: this.resultEl.querySelector('.park-btn-close'),
        }

        this.resEl.replayBtn.addEventListener('click', (e) =>
        {
            e.stopPropagation()
            const id = this.lastFinishedId
            this.hideResult()
            if(id) this.onReplay(id)
        })
        this.resEl.closeBtn.addEventListener('click', (e) =>
        {
            e.stopPropagation()
            this.hideResult()
        })
    }

    t(key, params)
    {
        return this.game.i18n?.t(key, params) ?? key
    }

    showHud({ id, icon, title, scoreLabel, timeLabel, comboLabel, hint })
    {
        this.hideResult()
        const rec = this.getRecord(id)
        this.el.icon.textContent = icon || '🏆'
        this.el.title.textContent = title || ''
        this.el.exitBtn.textContent = `${this.t('park.arcade.exit')} (Esc)`
        this.el.lblTime.textContent = timeLabel || this.t('park.arcade.time')
        this.el.lblScore.textContent = scoreLabel || this.t('park.arcade.score')
        this.el.lblCombo.textContent = comboLabel || 'COMBO'
        this.el.lblBest.textContent = this.t('park.arcade.best')
        this.el.best.textContent = rec.bestScore > 0
            ? `${MEDAL_ICON[rec.medal] || ''} ${rec.bestScore}`
            : '--'
        this.el.hint.textContent = hint || ''
        this.setTimingGauge(false)
        this.root.classList.add('is-active')
    }

    hideHud()
    {
        this.root.classList.remove('is-active')
        this.setTimingGauge(false)
        this.showCountdown(null)
    }

    updateHud({ timeText, timeWarn, timeCrit, scoreText, comboText, comboHot, hint })
    {
        if(typeof timeText !== 'undefined')
        {
            this.el.timer.textContent = timeText
            this.el.timer.classList.toggle('is-warn', !!timeWarn && !timeCrit)
            this.el.timer.classList.toggle('is-crit', !!timeCrit)
        }
        if(typeof scoreText !== 'undefined')
            this.el.score.textContent = scoreText
        if(typeof comboText !== 'undefined')
        {
            this.el.combo.textContent = comboText
            this.el.combo.classList.toggle('is-hot', !!comboHot)
        }
        if(typeof hint !== 'undefined')
            this.el.hint.textContent = hint
    }

    setTimingGauge(visible, gStart = 0.35, gEnd = 0.65, pStart = 0.45, pEnd = 0.55, needlePos = 0.5, caption = '')
    {
        this.el.timingWrap.classList.toggle('is-visible', !!visible)
        if(!visible) return
        this.el.zoneGood.style.left = `${(gStart * 100).toFixed(1)}%`
        this.el.zoneGood.style.width = `${((gEnd - gStart) * 100).toFixed(1)}%`
        this.el.zonePerfect.style.left = `${(pStart * 100).toFixed(1)}%`
        this.el.zonePerfect.style.width = `${((pEnd - pStart) * 100).toFixed(1)}%`
        this.el.needle.style.left = `${(needlePos * 100).toFixed(1)}%`
        if(caption)
            this.el.timingCaption.textContent = caption
    }

    showCountdown(text, isGo = false)
    {
        if(!text)
        {
            this.countdownEl.classList.remove('is-active', 'is-go')
            this.lastCountdownText = null
            return
        }
        if(text !== this.lastCountdownText)
        {
            this.lastCountdownText = text
            this.countdownEl.textContent = text
            this.countdownEl.classList.remove('is-active')
            void this.countdownEl.offsetWidth
            this.countdownEl.classList.add('is-active')
            this.countdownEl.classList.toggle('is-go', !!isGo)
        }
    }

    showToast(text, accent = 'gold', durationMs = 1350)
    {
        clearTimeout(this.toastTimer)
        this.toastEl.textContent = text
        this.toastEl.dataset.accent = accent
        this.toastEl.classList.remove('is-active')
        void this.toastEl.offsetWidth
        this.toastEl.classList.add('is-active')
        this.toastTimer = setTimeout(() =>
        {
            this.toastEl.classList.remove('is-active')
        }, durationMs)
    }

    showResult({ id, title, scoreText, medal, bestScore, isNewBest, summaryText })
    {
        clearTimeout(this.resultTimer)
        this.lastFinishedId = id
        this.resultEl.dataset.medal = medal
        this.resEl.medal.textContent = MEDAL_ICON[medal] || '🎯'
        this.resEl.title.textContent = title
        this.resEl.badge.textContent = isNewBest
            ? this.t('park.arcade.newRecord')
            : (medal !== 'none' ? this.t(`park.arcade.${medal}`) : '')
        this.resEl.badge.style.display = this.resEl.badge.textContent ? '' : 'none'
        this.resEl.score.textContent = scoreText
        this.resEl.meta.textContent = summaryText || `${this.t('park.arcade.best')}: ${bestScore}`
        this.resEl.replayBtn.textContent = this.t('park.arcade.replay')
        this.resEl.closeBtn.textContent = this.t('park.arcade.close')
        this.resultEl.classList.add('is-active')

        this.resultTimer = setTimeout(() =>
        {
            this.hideResult()
        }, 7000)
    }

    hideResult()
    {
        clearTimeout(this.resultTimer)
        this.resultEl.classList.remove('is-active')
    }

    // Audio procedural leve via Howler.ctx
    playTone(freq, duration = 0.25, wave = 'triangle', peak = 0.11, delay = 0)
    {
        if(this.game.audio?.mute?.active) return
        try
        {
            const ctx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext)()
            if(!ctx) return
            if(ctx.state === 'suspended') ctx.resume()
            const dest = Howler.masterGain || ctx.destination
            const t0 = ctx.currentTime + delay
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = wave
            osc.frequency.setValueAtTime(freq, t0)
            gain.gain.setValueAtTime(0.0001, t0)
            gain.gain.linearRampToValueAtTime(peak, t0 + 0.018)
            gain.gain.exponentialRampToValueAtTime(0.0006, t0 + duration)
            osc.connect(gain)
            gain.connect(dest)
            osc.start(t0)
            osc.stop(t0 + duration + 0.03)
        }
        catch(e) {}
    }

    playCountdownBeep(isGo = false)
    {
        this.playTone(isGo ? 880 : 440, isGo ? 0.34 : 0.14, isGo ? 'triangle' : 'sine', isGo ? 0.15 : 0.10)
    }

    playComboHit(combo = 1)
    {
        const scale = [ 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5 ]
        const idx = Math.min(scale.length - 1, Math.max(0, combo - 1))
        this.playTone(scale[idx], 0.22, 'triangle', 0.12)
        if(combo >= 3)
            this.playTone(scale[idx] * 1.5, 0.24, 'sine', 0.07, 0.05)
    }

    playErrorBuzz()
    {
        this.playTone(150, 0.26, 'sawtooth', 0.10)
        this.playTone(115, 0.28, 'sawtooth', 0.08, 0.08)
    }

    playBeatStep(step)
    {
        if(step % 2 === 0)
            this.playTone(step % 4 === 0 ? 78 : 110, 0.10, 'sine', 0.065)
        else
            this.playTone(840, 0.035, 'triangle', 0.025)
    }

    playFanfare(medal = 'gold')
    {
        const notes = medal === 'gold'
            ? [ 523.25, 659.25, 783.99, 1046.5, 1318.5 ]
            : medal === 'silver'
                ? [ 440, 554.37, 659.25, 880 ]
                : [ 392, 493.88, 587.33 ]
        notes.forEach((f, i) => this.playTone(f, 0.42, 'triangle', 0.12, i * 0.09))
    }
}
