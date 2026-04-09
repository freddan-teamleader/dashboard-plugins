// @bump: patch
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from Augusta National",
  height: 500,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  hiddenConfig: { cachedPlayers: null },

  render: async function(container, config) {
    const max = Math.min(config.maxPlayers || 10, 20)
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941'

    if (!document.getElementById('masters-style')) {
      const s = document.createElement('style')
      s.id = 'masters-style'
      s.textContent = `
        .masters-wrap { font-family: Georgia, serif; background: #0a1a0a; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .masters-head { background: linear-gradient(135deg, #1a3a1a, #0f2a0f); padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #4a7c4a; flex-shrink: 0; }
        .masters-logo { font-size: 22px; }
        .masters-title { flex: 1; }
        .masters-title h2 { margin: 0; font-size: 14px; color: #f0c040; letter-spacing: 1px; }
        .masters-title p  { margin: 0; font-size: 10px; color: #4ade80; }
        .masters-updated { font-size: 9px; color: #64748b; }
        .masters-table-wrap { flex: 1; overflow-y: auto; }
        .masters-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .masters-table thead th { background: #1a3a1a; color: #f0c040; padding: 5px 6px; text-align: center; position: sticky; top: 0; z-index: 1; font-size: 10px; letter-spacing: 0.5px; }
        .masters-table thead th:nth-child(2) { text-align: left; }
        .masters-table tbody tr { border-bottom: 1px solid #1e2d1e; transition: background 0.15s; }
        .masters-table tbody tr:hover { background: #1a2a1a; }
        .masters-table td { padding: 5px 6px; text-align: center; white-space: nowrap; }
        .masters-table td:nth-child(2) { text-align: left; }
        .pos { color: #94a3b8; font-size: 10px; min-width: 28px; }
        .pos.lead { color: #f0c040; font-weight: bold; }
        .name { color: #e2e8f0; font-weight: bold; font-size: 11px; }
        .name .country { color: #64748b; font-size: 9px; font-weight: normal; margin-left: 4px; }
        .score-under { color: #4ade80; font-weight: bold; }
        .score-over  { color: #ff6b6b; font-weight: bold; }
        .score-even  { color: #e2e8f0; }
        .thru { color: #60a5fa; font-size: 10px; }
        .mov-up   { color: #4ade80; font-size: 9px; }
        .mov-down { color: #ff6b6b; font-size: 9px; }
        .mov-flat { color: #64748b; font-size: 9px; }
        .masters-footer { padding: 4px 10px; background: #0f2a0f; border-top: 1px solid #1a3a1a; font-size: 9px; color: #4a7c4a; text-align: center; flex-shrink: 0; }
        .masters-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #4a7c4a; font-size: 13px; }
        .masters-error { display: flex; align-items: center; justify-content: center; height: 100%; color: #ff6b6b; font-size: 12px; padding: 20px; text-align: center; }
      `
      document.head.appendChild(s)
    }

    const fetchText = async (url) => { const r = await api.fetch(url); return r.text() }
    const rx    = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*?)"`)); return m ? m[1] : null }
    const rxNum = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*(-?[\\d.]+)`)); return m ? parseFloat(m[1]) : null }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const scoreClass = v => isNaN(v) ? 'score-even' : v < 0 ? 'score-under' : v > 0 ? 'score-over' : 'score-even'
    const fmtScore  = v => isNaN(v) || v === 0 ? 'E' : v > 0 ? `+${v}` : `${v}`

    // --- Phase 1: fetch IDs + names (only on first load, cached after) ---
    const loadRoster = async () => {
      const players = []
      for (let page = 1; page <= max; page++) {
        const t = await fetchText(`${BASE}/competitors?limit=1&page=${page}&lang=en&region=us`)
        const id = rx(t, 'id')
        if (!id || id === '401811941') continue
        const order = rxNum(t, 'order') ?? page
        players.push({ id, order })
        await sleep(80)
      }

      // Fetch names sequentially
      for (const p of players) {
        const t = await fetchText(`https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/${p.id}?lang=en&region=us`)
        p.name    = rx(t, 'fullName') || rx(t, 'displayName') || rx(t, 'shortName') || `Player ${p.id}`
        p.country = rx(t, 'citizenship') || ''
        await sleep(80)
      }

      return players
    }

    // --- Phase 2: fetch only scores + statuses (used on every refresh) ---
    const loadScores = async (players) => {
      for (const p of players) {
        try {
          const [scoreTxt, statusTxt] = await Promise.all([
            fetchText(`${BASE}/competitors/${p.id}/score?lang=en&region=us`),
            fetchText(`${BASE}/competitors/${p.id}/status?lang=en&region=us`)
          ])
          // Score — always to-par
          p.totDisp = rx(scoreTxt, 'completedRoundsDisplayValue') || rx(scoreTxt, 'displayValue') || 'E'
          p.totVal  = rxNum(scoreTxt, 'completedRoundsValue') ?? rxNum(scoreTxt, 'value') ?? 0

          // Status
          const thru  = rxNum(statusTxt, 'thru')
          const hole  = rxNum(statusTxt, 'hole')
          const state = rx(statusTxt, 'name') || ''
          const done  = state.includes('COMPLETE') || state.includes('completed') || rx(statusTxt, 'completed') === 'true'
          p.thruDisp  = done ? 'F' : thru != null ? `${thru}` : hole != null ? `*${hole}` : '-'

          // Movement from competitor page
          const compTxt = await fetchText(`${BASE}/competitors/${p.id}?lang=en&region=us`)
          p.mov = rxNum(compTxt, 'movement') ?? 0
        } catch(e) {
          console.warn(`Score fetch failed for ${p.id}:`, e)
        }
        await sleep(100)
      }
    }

    // --- Render table from player array ---
    const renderTable = (players, status) => {
      // Sort + compute tied positions
      const sorted = [...players].sort((a, b) => (a.totVal ?? 999) - (b.totVal ?? 999))
      let posCounter = 1
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i].totVal === sorted[i-1].totVal) {
          sorted[i].displayPos = sorted[i-1].displayPos
          sorted[i].isTie = true
          sorted[i-1].isTie = true
        } else {
          posCounter = i + 1
          sorted[i].displayPos = posCounter
          sorted[i].isTie = false
        }
      }

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const rows = sorted.map(p => {
        const posLabel = p.isTie ? `T${p.displayPos}` : `${p.displayPos}`
        const posClass = p.displayPos === 1 && !p.isTie ? 'pos lead' : 'pos'
        const movIcon  = p.mov > 0 ? `<span class="mov-up">▲${p.mov}</span>`
                       : p.mov < 0 ? `<span class="mov-down">▼${Math.abs(p.mov)}</span>`
                       : `<span class="mov-flat">—</span>`
        return `<tr>
          <td class="${posClass}">${posLabel}</td>
          <td><span class="name">${p.name}<span class="country">${p.country ? ' ' + p.country : ''}</span></span></td>
          <td class="${scoreClass(p.totVal)}">${fmtScore(p.totVal)}</td>
          <td class="thru">${p.thruDisp ?? '-'}</td>
          <td>${movIcon}</td>
        </tr>`
      }).join('')

      container.innerHTML = `
        <div class="masters-wrap">
          <div class="masters-head">
            <div class="masters-logo">⛳</div>
            <div class="masters-title">
              <h2>THE MASTERS 2026</h2>
              <p>Augusta National · ${status}</p>
            </div>
            <div class="masters-updated">↻ ${now}</div>
          </div>
          <div class="masters-table-wrap">
            <table class="masters-table">
              <thead><tr>
                <th>POS</th><th>PLAYER</th><th>TOT</th><th>THRU</th><th>MOV</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="masters-footer">Data: ESPN · Refreshes every ${config.refreshSeconds || 60}s</div>
        </div>`
    }

    // --- Main load orchestrator ---
    let players = config.cachedPlayers || null

    const load = async (isRefresh = false) => {
      try {
        if (!players) {
          // First load — fetch everything
          container.innerHTML = `<div class="masters-wrap"><div class="masters-loading">⛳ Loading roster…</div></div>`
          players = await loadRoster()
          if (!players.length) throw new Error('No players found')
          // Show names immediately with placeholder scores
          players.forEach(p => { p.totVal = 0; p.totDisp = 'E'; p.thruDisp = '-'; p.mov = 0 })
          renderTable(players, 'Loading scores…')
        }

        // Always refresh scores
        await loadScores(players)

        // Cache the roster (ids + names) so next render skips Phase 1
        api.updateConfig({ cachedPlayers: players.map(p => ({ id: p.id, order: p.order, name: p.name, country: p.country })) })

        renderTable(players, 'In Progress')
      } catch(e) {
        container.innerHTML = `<div class="masters-wrap"><div class="masters-error">⚠️ ${e.message}</div></div>`
      }
    }

    await load()
    const interval = setInterval(() => load(true), (config.refreshSeconds || 60) * 1000)
    container.__cleanup__ = () => clearInterval(interval)
  }
})