// @bump: minor
// Single instance lock — prevents React Strict Mode double-execution
let _masterInstance = null

api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from Augusta National",
  height: 500,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  hiddenConfig: { cachedRoster: null },

  render: async function(container, config) {
    if (_masterInstance) {
      clearInterval(_masterInstance.interval)
      _masterInstance.dead = true
      _masterInstance = null
    }
    const instance = { interval: null, dead: false }
    _masterInstance = instance

    const PAR  = 72
    const max  = Math.min(config.maxPlayers || 10, 20)
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const COMP = `${BASE}/events/401811941/competitions/401811941`
    const ATH  = `${BASE}/seasons/2026/athletes`

    const sleep    = ms => new Promise(r => setTimeout(r, ms))
    const fetchTxt = async url => { const r = await api.fetch(url); return r.text() }
    const rx       = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*?)"`)); return m ? m[1] : null }
    const rxNum    = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*(-?[\\d.]+)`)); return m ? parseFloat(m[1]) : null }

    // ESPN CDN flag image from 3-letter country code
    const flagUrl = code => code ? `https://a.espncdn.com/i/teamlogos/countries/500/${code.toLowerCase()}.png` : null

    const fmtToPar = v => {
      if (v === null || v === undefined || isNaN(v)) return 'E'
      if (v === 0) return 'E'
      return v > 0 ? `+${v}` : `${v}`
    }

    // ── Styles ─────────────────────────────────────────────────────────
    if (!document.getElementById('masters-2026-style')) {
      const s = document.createElement('style')
      s.id = 'masters-2026-style'
      s.textContent = `
        .masters-wrap { font-family: 'Georgia', serif; background: #0f172a; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .masters-head { background: linear-gradient(135deg, #14532d, #166534); padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
        .masters-head h2 { margin: 0; font-size: 14px; color: #fbbf24; letter-spacing: 1px; text-transform: uppercase; }
        .masters-head span { font-size: 10px; color: #86efac; }
        .masters-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .masters-table th { background: #1e293b; color: #94a3b8; padding: 5px 8px; text-align: left; font-weight: normal; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; z-index: 1; }
        .masters-table th.num { text-align: right; }
        .masters-table td { padding: 5px 8px; border-bottom: 1px solid #1e293b; white-space: nowrap; }
        .masters-table td.num { text-align: right; }
        .masters-table tr:hover td { background: #1e293b; }
        .masters-scroll { overflow-y: auto; flex: 1; }
        .pos-cell { color: #94a3b8; font-size: 11px; min-width: 28px; }
        .flag-cell { width: 22px; padding: 3px 4px !important; }
        .flag-cell img { width: 18px; height: 13px; object-fit: cover; border-radius: 2px; display: block; vertical-align: middle; }
        .flag-cell .no-flag { width: 18px; height: 13px; display: inline-block; }
        .name-cell { font-weight: bold; color: #e2e8f0; }
        .score-neg { color: #4ade80; font-weight: bold; }
        .score-pos { color: #ff6b6b; font-weight: bold; }
        .score-e   { color: #e2e8f0; font-weight: bold; }
        .thru-cell { color: #94a3b8; font-size: 11px; }
        .mov-up   { color: #4ade80; font-size: 10px; }
        .mov-dn   { color: #ff6b6b; font-size: 10px; }
        .mov-nc   { color: #64748b; font-size: 10px; }
        .r-score  { color: #94a3b8; }
        .r-active { color: #60a5fa; font-weight: bold; }
        .masters-status { padding: 20px; text-align: center; color: #94a3b8; font-size: 13px; }
        .masters-err    { padding: 20px; text-align: center; color: #ff6b6b; font-size: 13px; }
      `
      document.head.appendChild(s)
    }

    container.innerHTML = `
      <div class="masters-wrap">
        <div class="masters-head">
          <h2>⛳ The Masters 2026</h2>
          <span id="masters-status-lbl">Loading…</span>
        </div>
        <div class="masters-scroll">
          <table class="masters-table">
            <thead><tr>
              <th>POS</th><th colspan="2">PLAYER</th>
              <th class="num">TOT</th><th class="num">R1</th><th class="num">R2</th><th class="num">R3</th><th class="num">R4</th>
              <th class="num">THRU</th><th class="num">MOV</th>
            </tr></thead>
            <tbody id="masters-body"><tr><td colspan="10" class="masters-status">Loading leaderboard…</td></tr></tbody>
          </table>
        </div>
      </div>`

    const lbl   = container.querySelector('#masters-status-lbl')
    const tbody = container.querySelector('#masters-body')

    const scoreClass = v => v < 0 ? 'score-neg' : v > 0 ? 'score-pos' : 'score-e'
    const movHTML = v => v > 0 ? `<span class="mov-up">▲${v}</span>`
                       : v < 0 ? `<span class="mov-dn">▼${Math.abs(v)}</span>`
                       : `<span class="mov-nc">—</span>`

    const computePositions = arr => {
      arr.sort((a, b) => a.totVal - b.totVal)
      let i = 0
      while (i < arr.length) {
        let j = i
        while (j < arr.length && arr[j].totVal === arr[i].totVal) j++
        const pos  = i + 1
        const tied = j - i > 1
        for (let k = i; k < j; k++) arr[k].displayPos = tied ? `T${pos}` : `${pos}`
        i = j
      }
    }

    const flagHTML = p => {
      if (p.flagCode) {
        return `<img src="${flagUrl(p.flagCode)}" alt="${p.country || ''}" title="${p.country || ''}" onerror="this.style.display='none'">`
      }
      return `<span class="no-flag"></span>`
    }

    const renderTable = arr => {
      if (!arr.length) { tbody.innerHTML = '<tr><td colspan="10" class="masters-status">No data</td></tr>'; return }
      tbody.innerHTML = arr.map(p => `
        <tr data-id="${p.id}">
          <td class="pos-cell">${p.displayPos || '-'}</td>
          <td class="flag-cell">${flagHTML(p)}</td>
          <td class="name-cell">${p.name}</td>
          <td class="num ${scoreClass(p.totVal)}">${fmtToPar(p.totVal)}</td>
          <td class="num r-score ${p.activeRound===1?'r-active':''}">${p.r1 ?? '-'}</td>
          <td class="num r-score ${p.activeRound===2?'r-active':''}">${p.r2 ?? '-'}</td>
          <td class="num r-score ${p.activeRound===3?'r-active':''}">${p.r3 ?? '-'}</td>
          <td class="num r-score ${p.activeRound===4?'r-active':''}">${p.r4 ?? '-'}</td>
          <td class="num thru-cell">${p.thruDisp ?? '-'}</td>
          <td class="num">${movHTML(p.mov ?? 0)}</td>
        </tr>`).join('')
    }

    let players = null

    const loadRoster = async () => {
      lbl.textContent = 'Loading roster…'
      const entries = []
      for (let page = 1; page <= max; page++) {
        if (instance.dead) return []
        const t  = await fetchTxt(`${COMP}/competitors?limit=1&page=${page}`)
        const id = t.match(/"id"\s*:\s*"(\d+)"/)?.[1]
        if (id && id !== '401811941') entries.push({ id, order: page })
        await sleep(80)
      }
      const roster = []
      for (const e of entries) {
        if (instance.dead) return []
        const t        = await fetchTxt(`${ATH}/${e.id}`)
        const name     = rx(t, 'fullName') || rx(t, 'displayName') || rx(t, 'shortName') || `Player ${e.id}`
        const country  = rx(t, 'citizenship') || ''
        // Extract 3-letter country code from citizenshipCountry.abbreviation or flag href
        const flagCode = rx(t, 'abbreviation') || ''   // e.g. "usa", "nir", "aus"
        roster.push({ id: e.id, name, country, flagCode })
        await sleep(80)
      }
      api.updateConfig({ cachedRoster: roster })
      return roster
    }

    const loadScores = async () => {
      lbl.textContent = 'Updating scores…'
      for (const p of players) {
        if (instance.dead) return
        try {
          const [scoreTxt, statusTxt] = await Promise.all([
            fetchTxt(`${COMP}/competitors/${p.id}/score`),
            fetchTxt(`${COMP}/competitors/${p.id}/status`)
          ])

          // Parse to-par: completedRoundsDisplayValue is most reliable
          const crDisp = rx(scoreTxt, 'completedRoundsDisplayValue')
          if (crDisp !== null && crDisp !== '') {
            p.totVal = (crDisp === 'E' || crDisp === 'Even') ? 0 : (parseFloat(crDisp) || 0)
          } else {
            const disp = rx(scoreTxt, 'displayValue')
            if (disp === 'E' || disp === 'Even') {
              p.totVal = 0
            } else if (disp && parseFloat(disp) && Math.abs(parseFloat(disp)) <= 30) {
              p.totVal = parseFloat(disp)
            } else {
              const raw = rxNum(scoreTxt, 'value')
              p.totVal = raw !== null ? Math.round(raw) - PAR : 0
            }
          }

          p.mov = rxNum(scoreTxt, 'movement') ?? p.mov ?? 0

          const state      = rx(statusTxt, 'state') || ''
          const thru       = rxNum(statusTxt, 'thru')
          const hole       = rxNum(statusTxt, 'hole')
          const isFinished = state === 'post'
          p.thruDisp = isFinished ? 'F' : thru != null ? `${thru}` : hole != null ? `*${hole}` : '-'

        } catch(e) {
          console.warn(`Failed score for ${p.id}:`, e)
        }
        await sleep(80)
      }
    }

    const loadLinescores = async () => {
      for (const p of players) {
        if (instance.dead) return
        try {
          const t = await fetchTxt(`${COMP}/competitors/${p.id}/linescores`)
          p.r1 = '-'; p.r2 = '-'; p.r3 = '-'; p.r4 = '-'; p.activeRound = 0

          // Split on "linescores" keyword — everything before it in each item is the round total
          // Items are separated by "period" at the top level
          const itemRx = /"value"\s*:\s*(\d+(?:\.\d+)?)\s*,\s*"displayValue"\s*:\s*"([^"]*)"\s*,\s*"period"\s*:\s*(\d+)/g
          for (const m of t.matchAll(itemRx)) {
            const strokes = parseInt(m[1])
            const period  = parseInt(m[3])
            // Round totals are 50-85 strokes; hole scores are 1-8
            if (strokes < 50 || strokes > 85) continue
            if      (period === 1) { p.r1 = strokes; p.activeRound = Math.max(p.activeRound, 1) }
            else if (period === 2) { p.r2 = strokes; p.activeRound = Math.max(p.activeRound, 2) }
            else if (period === 3) { p.r3 = strokes; p.activeRound = Math.max(p.activeRound, 3) }
            else if (period === 4) { p.r4 = strokes; p.activeRound = Math.max(p.activeRound, 4) }
          }
        } catch(e) {
          console.warn(`Linescore failed ${p.id}:`, e)
        }
        await sleep(80)
      }
    }

    const load = async (isRefresh = false) => {
      if (instance.dead) return
      try {
        if (!players) {
          let roster = config.cachedRoster
          if (!roster?.length) roster = await loadRoster()
          if (instance.dead) return
          players = roster.map(p => ({
            ...p, totVal: 0, thruDisp: '-', mov: 0,
            r1: '-', r2: '-', r3: '-', r4: '-', activeRound: 0
          }))
          await loadScores()
          if (instance.dead) return
          computePositions(players)
          renderTable(players)
          await loadLinescores()
          if (instance.dead) return
          computePositions(players)
          renderTable(players)
        } else {
          await loadScores()
          if (instance.dead) return
          computePositions(players)
          renderTable(players)
        }
        lbl.textContent = `Updated ${new Date().toLocaleTimeString()}`
      } catch(e) {
        if (instance.dead) return
        console.error('Masters error:', e)
        tbody.innerHTML = `<tr><td colspan="10" class="masters-err">⚠️ ${e.message}</td></tr>`
        lbl.textContent = 'Error'
      }
    }

    await load()
    instance.interval = setInterval(() => load(true), (config.refreshSeconds || 60) * 1000)
    container.__cleanup__ = () => {
      instance.dead = true
      clearInterval(instance.interval)
      if (_masterInstance === instance) _masterInstance = null
    }
  }
})