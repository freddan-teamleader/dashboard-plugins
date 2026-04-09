// @bump: patch
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from Augusta National",
  height: 500,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  hiddenConfig: { cachedRoster: null },

  render: async function(container, config) {
    const max = Math.min(config.maxPlayers || 10, 20)
    const COMP = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941'
    const ATH  = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes'
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const fetchText = async url => { const r = await api.fetch(url); return r.text() }
    const rx    = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*?)"`)); return m ? m[1] : null }
    const rxNum = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*(-?[\\d.]+)`)); return m ? parseFloat(m[1]) : null }

    // ── Styles ────────────────────────────────────────────────────────
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
        .name-cell { font-weight: bold; color: #e2e8f0; }
        .ctry-cell { color: #64748b; font-size: 10px; }
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
              <th>POS</th><th>PLAYER</th><th></th>
              <th class="num">TOT</th><th class="num">R1</th><th class="num">R2</th><th class="num">R3</th><th class="num">R4</th>
              <th class="num">THRU</th><th class="num">MOV</th>
            </tr></thead>
            <tbody id="masters-body"><tr><td colspan="10" class="masters-status">Loading leaderboard…</td></tr></tbody>
          </table>
        </div>
      </div>`

    const lbl   = container.querySelector('#masters-status-lbl')
    const tbody = container.querySelector('#masters-body')

    // ── Helpers ───────────────────────────────────────────────────────
    const scoreClass = v => v < 0 ? 'score-neg' : v > 0 ? 'score-pos' : 'score-e'

    // Always show to-par: negative = "-5", zero = "E", positive = "+3"
    const fmtToPar = val => {
      if (val === null || val === undefined || isNaN(val)) return 'E'
      if (val === 0) return 'E'
      if (val > 0) return `+${val}`
      return `${val}`
    }

    const movHTML = v => v > 0 ? `<span class="mov-up">▲${v}</span>`
                       : v < 0 ? `<span class="mov-dn">▼${Math.abs(v)}</span>`
                       : `<span class="mov-nc">—</span>`

    // ── Compute positions client-side from sorted totVal ──────────────
    const computePositions = arr => {
      // Sort by totVal ascending (lower = better in golf)
      arr.sort((a, b) => a.totVal - b.totVal)

      let pos = 1
      for (let i = 0; i < arr.length; i++) {
        if (i === 0) {
          arr[i].displayPos = '1'
          arr[i].isTie = false
        } else if (arr[i].totVal === arr[i - 1].totVal) {
          // Tie — same position as previous, mark both as tied
          const tiePos = arr[i - 1].displayPos.replace('T', '')
          arr[i].displayPos = `T${tiePos}`
          if (!arr[i - 1].isTie) {
            arr[i - 1].displayPos = `T${tiePos}`
            arr[i - 1].isTie = true
          }
          arr[i].isTie = true
        } else {
          pos = i + 1
          arr[i].displayPos = `${pos}`
          arr[i].isTie = false
        }
      }
    }

    const renderTable = arr => {
      if (!arr.length) { tbody.innerHTML = '<tr><td colspan="10" class="masters-status">No data</td></tr>'; return }
      tbody.innerHTML = arr.map(p => `
        <tr data-id="${p.id}">
          <td class="pos-cell">${p.displayPos || '-'}</td>
          <td class="name-cell">${p.name}</td>
          <td class="ctry-cell">${p.country}</td>
          <td class="num ${scoreClass(p.totVal)}">${fmtToPar(p.totVal)}</td>
          <td class="num r-score ${p.activeRound===1?'r-active':''}">${p.r1 ?? '-'}</td>
          <td class="num r-score ${p.activeRound===2?'r-active':''}">${p.r2 ?? '-'}</td>
          <td class="num r-score ${p.activeRound===3?'r-active':''}">${p.r3 ?? '-'}</td>
          <td class="num r-score ${p.activeRound===4?'r-active':''}">${p.r4 ?? '-'}</td>
          <td class="num thru-cell">${p.thruDisp ?? '-'}</td>
          <td class="num">${movHTML(p.mov ?? 0)}</td>
        </tr>`).join('')
    }

    // ── Phase 1 — Roster (once only, cached) ─────────────────────────
    let players = null

    const loadRoster = async () => {
      lbl.textContent = 'Loading roster…'
      const entries = []
      for (let page = 1; page <= max; page++) {
        const t = await fetchText(`${COMP}/competitors?limit=1&page=${page}`)
        const id = rx(t, 'id')
        if (!id || id === '401811941') continue
        const order = rxNum(t, 'order') ?? page
        entries.push({ id, order })
        await sleep(100)
      }
      entries.sort((a, b) => a.order - b.order)

      const roster = []
      for (const e of entries) {
        const t = await fetchText(`${ATH}/${e.id}`)
        const name = rx(t, 'fullName') || rx(t, 'displayName') || rx(t, 'shortName') || `Player ${e.id}`
        const country = rx(t, 'citizenship') || ''
        roster.push({ id: e.id, name, country, totVal: 0, totDisp: 'E', thruDisp: '-', mov: 0, r1: '-', r2: '-', r3: '-', r4: '-', activeRound: 0 })
        await sleep(100)
      }
      api.updateConfig({ cachedRoster: roster.map(p => ({ id: p.id, name: p.name, country: p.country })) })
      return roster
    }

    // ── Phase 2 — Scores only (every refresh) ────────────────────────
    const loadScores = async roster => {
      lbl.textContent = 'Updating scores…'
      for (const p of roster) {
        try {
          const [st, ss] = await Promise.all([
            fetchText(`${COMP}/competitors/${p.id}/score`),
            fetchText(`${COMP}/competitors/${p.id}/status`)
          ])

          // TOT — always to-par: prefer completedRoundsValue (numeric to-par total)
          const crdv = rx(st, 'completedRoundsDisplayValue')  // e.g. "-7"
          const crv  = rxNum(st, 'completedRoundsValue')       // e.g. -7 (numeric)
          const dv   = rx(st, 'displayValue')                  // fallback display
          const v    = rxNum(st, 'value')                      // fallback numeric

          // Use completedRoundsValue as the numeric totVal if available
          // completedRoundsValue is always to-par (negative = under par)
          p.totVal  = crv ?? v ?? 0
          p.totDisp = crdv || dv || fmtToPar(p.totVal)

          // Make sure totDisp is always to-par format, not stroke total
          // If totDisp looks like a raw stroke count (> 40), recompute from totVal
          if (p.totDisp && parseFloat(p.totDisp) > 40) {
            p.totDisp = fmtToPar(p.totVal)
          }

          // Status
          const done = ss.includes('"completed":true') || ss.includes('COMPLETE') || rx(ss, 'name') === 'STATUS_ENDED'
          const thru = rxNum(ss, 'thru')
          const hole = rxNum(ss, 'hole')
          p.thruDisp = done ? 'F' : thru != null ? `${thru}` : hole != null ? `*${hole}` : '-'
          p.mov      = rxNum(ss, 'movement') ?? p.mov ?? 0

          // Linescores
          const ls = await fetchText(`${COMP}/competitors/${p.id}/linescores`)
          p.r1 = '-'; p.r2 = '-'; p.r3 = '-'; p.r4 = '-'; p.activeRound = 0
          for (const [, period, val] of ls.matchAll(/"period"\s*:\s*(\d+)[^}]*?"value"\s*:\s*(\d+)/g)) {
            const rnd = parseInt(period), score = parseInt(val)
            if (rnd === 1) p.r1 = score
            else if (rnd === 2) p.r2 = score
            else if (rnd === 3) p.r3 = score
            else if (rnd === 4) p.r4 = score
            p.activeRound = Math.max(p.activeRound || 0, rnd)
          }
          await sleep(80)
        } catch(e) {
          console.warn(`Failed player ${p.id}:`, e)
        }
      }
    }

    // ── Main load ─────────────────────────────────────────────────────
    const load = async () => {
      try {
        if (!players) {
          if (config.cachedRoster?.length) {
            players = config.cachedRoster.map(p => ({
              ...p, totVal: 0, totDisp: 'E', thruDisp: '-', mov: 0,
              r1: '-', r2: '-', r3: '-', r4: '-', activeRound: 0
            }))
          } else {
            players = await loadRoster()
          }
        }
        await loadScores(players)
        computePositions(players)
        renderTable(players)
        lbl.textContent = `Updated ${new Date().toLocaleTimeString()}`
      } catch(e) {
        console.error('Error:', e)
        tbody.innerHTML = `<tr><td colspan="10" class="masters-err">⚠️ ${e.message}</td></tr>`
        lbl.textContent = 'Error'
      }
    }

    await load()
    const interval = setInterval(load, (config.refreshSeconds || 60) * 1000)
    container.__cleanup__ = () => clearInterval(interval)
  }
})