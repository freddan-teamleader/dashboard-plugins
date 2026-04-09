api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard for the 2026 Masters Tournament",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },

  render: async function(container, config) {
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941'
    const ATH  = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes'

    // ── stable styles injected once ──────────────────────────────────────────
    const STYLE_ID = 'masters-2026-style'
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style')
      s.id = STYLE_ID
      s.textContent = `
        .masters-wrap { display:flex; flex-direction:column; height:100%; background:#0f2417; color:#e2e8f0; font-family:'Georgia',serif; box-sizing:border-box; }
        .masters-head { background:linear-gradient(135deg,#1a3a24,#0f2417); padding:10px 14px 8px; border-bottom:2px solid #f0c040; flex-shrink:0; }
        .masters-head h2 { margin:0; font-size:15px; color:#f0c040; letter-spacing:1px; text-transform:uppercase; }
        .masters-head .sub { font-size:10px; color:#94a3b8; margin-top:2px; font-family:sans-serif; }
        .masters-scroll { flex:1; overflow-y:auto; min-height:0; }
        .masters-scroll::-webkit-scrollbar { width:4px; }
        .masters-scroll::-webkit-scrollbar-track { background:#0a1a10; }
        .masters-scroll::-webkit-scrollbar-thumb { background:#2d5a3a; border-radius:2px; }
        .masters-table { width:100%; border-collapse:collapse; font-size:12px; }
        .masters-table th { position:sticky; top:0; background:#0f2417; color:#f0c040; font-weight:normal; font-family:sans-serif; font-size:10px; text-transform:uppercase; letter-spacing:.5px; padding:5px 6px; border-bottom:1px solid #2d5a3a; text-align:center; z-index:1; }
        .masters-table th.left { text-align:left; }
        .masters-table td { padding:5px 6px; border-bottom:1px solid #1a3a24; text-align:center; vertical-align:middle; }
        .masters-table td.left { text-align:left; }
        .masters-table tr:hover td { background:rgba(240,192,64,0.06); }
        .masters-table tr.leader td { background:rgba(240,192,64,0.08); }
        .col-pos  { width:36px; color:#94a3b8; font-family:sans-serif; font-size:11px; }
        .col-name { font-size:12px; }
        .col-tot  { width:38px; font-weight:bold; font-size:13px; }
        .col-r    { width:28px; color:#94a3b8; font-family:sans-serif; font-size:11px; }
        .col-thru { width:36px; color:#94a3b8; font-family:sans-serif; font-size:10px; }
        .col-mov  { width:24px; font-family:sans-serif; font-size:10px; }
        .score-under { color:#4ade80; }
        .score-over  { color:#ff6b6b; }
        .score-even  { color:#e2e8f0; }
        .mov-up   { color:#4ade80; }
        .mov-down { color:#ff6b6b; }
        .amateur-badge { font-size:8px; color:#f0c040; vertical-align:super; margin-left:2px; }
        .masters-foot { padding:4px 10px; font-size:9px; color:#4a7a5a; font-family:sans-serif; border-top:1px solid #1a3a24; flex-shrink:0; display:flex; justify-content:space-between; }
      `
      document.head.appendChild(s)
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    const fetchText = url => api.fetch(url).then(r => r.text())
    const rx  = (text, key) => { const m = text.match(new RegExp(`"${key}":\\s*"([^"]*?)"`)); return m ? m[1] : null }
    const rxN = (text, key) => { const m = text.match(new RegExp(`"${key}":\\s*(-?[\\d.]+)`)); return m ? parseFloat(m[1]) : null }

    const scoreClass = v => v < 0 ? 'score-under' : v > 0 ? 'score-over' : 'score-even'
    const scoreFmt   = v => v < 0 ? `${v}` : v > 0 ? `+${v}` : 'E'

    // ── skeleton ─────────────────────────────────────────────────────────────
    container.innerHTML = `
      <div class="masters-wrap">
        <div class="masters-head">
          <h2>⛳ The Masters 2026</h2>
          <div class="sub" id="m-status">Loading…</div>
        </div>
        <div class="masters-scroll">
          <table class="masters-table">
            <thead><tr>
              <th class="left col-pos">POS</th>
              <th class="left col-name">PLAYER</th>
              <th class="col-tot">TOT</th>
              <th class="col-r">R1</th>
              <th class="col-r">R2</th>
              <th class="col-r">R3</th>
              <th class="col-r">R4</th>
              <th class="col-thru">THRU</th>
              <th class="col-mov"></th>
            </tr></thead>
            <tbody id="m-body"><tr><td colspan="9" style="text-align:center;padding:20px;color:#4a7a5a">Loading leaderboard…</td></tr></tbody>
          </table>
        </div>
        <div class="masters-foot">
          <span>Augusta National · No API key required</span>
          <span id="m-updated"></span>
        </div>
      </div>`

    // ── fetch one player (all raw text, no JSON.parse) ────────────────────────
    async function fetchPlayer(id, order) {
      try {
        const [scoreTxt, statusTxt, athTxt] = await Promise.all([
          fetchText(`${BASE}/competitors/${id}/score`),
          fetchText(`${BASE}/competitors/${id}/status`),
          fetchText(`${ATH}/${id}`)
        ])

        // score — use completedRoundsDisplayValue for total-to-par (always to-par)
        // Fall back to displayValue if completedRounds not available
        const totDisp  = rx(scoreTxt,  'completedRoundsDisplayValue') ?? rx(scoreTxt, 'displayValue')
        const totVal   = rxN(scoreTxt, 'completedRoundsValue')        ?? rxN(scoreTxt, 'value')
        const totStrokes = rxN(scoreTxt, 'value') // always raw strokes total

        // status
        const thru     = rxN(statusTxt, 'thru')
        const hole     = rxN(statusTxt, 'hole')
        const state    = rx(statusTxt,  'state')
        const posDisp  = rx(statusTxt,  'displayName') // position displayName e.g. "1"
        const isTie    = statusTxt.includes('"isTie":true')
        const posNum   = rxN(statusTxt, '"id"')        // position id

        // athlete
        const fullName = rx(athTxt, 'fullName') ?? rx(athTxt, 'displayName') ?? `Player ${id}`
        const amateur  = athTxt.includes('"amateur":true')

        // movement from competitor page
        const compTxt  = await fetchText(`${BASE}/competitors/${id}`)
        const movement = rxN(compTxt, 'movement') ?? 0

        return { id, order, fullName, amateur, totDisp, totVal, totStrokes, thru, hole, state, isTie, movement, r: [null,null,null,null] }
      } catch(e) {
        console.warn(`Failed player ${id}:`, e)
        return null
      }
    }

    // ── fetch linescores async ────────────────────────────────────────────────
    async function fetchLinescores(id) {
      try {
        const txt = await fetchText(`${BASE}/competitors/${id}/linescores`)
        const rounds = []
        // extract each round's displayValue + period
        const items = [...txt.matchAll(/"period":(\d+).*?"displayValue":"([^"]+)"/g)]
        // only top-level rounds (period appears twice per round: once for round, once per hole)
        // grab items where the match is the round summary (value is like "-5","69","E","+2")
        const roundSummaryRx = /"value":(\d{2}),"displayValue":"([^"]+)","period":(\d)/g
        let m
        while ((m = roundSummaryRx.exec(txt)) !== null) {
          rounds[parseInt(m[3]) - 1] = m[2]
        }
        return rounds
      } catch(e) { return [null,null,null,null] }
    }

    // ── assign tied positions ─────────────────────────────────────────────────
    function assignPositions(players) {
      // sort by totVal ascending (lower = better)
      players.sort((a, b) => (a.totVal ?? 999) - (b.totVal ?? 999))
      let pos = 1
      for (let i = 0; i < players.length; i++) {
        if (i > 0 && players[i].totVal === players[i-1].totVal) {
          players[i].displayPos = players[i-1].displayPos
          players[i].isTie = true
          players[i-1].isTie = true
        } else {
          pos = i + 1
          players[i].displayPos = `${pos}`
          players[i].isTie = false
        }
      }
      return players
    }

    // ── render table ──────────────────────────────────────────────────────────
    function renderTable(players) {
      const body = container.querySelector('#m-body')
      if (!body) return
      body.innerHTML = players.map((p, i) => {
        const pos     = p.isTie ? `T${p.displayPos}` : p.displayPos
        const tot     = p.totVal != null ? scoreFmt(p.totVal) : '—'
        const totCls  = p.totVal != null ? scoreClass(p.totVal) : ''
        const thruTxt = p.state === 'post' ? 'F' : p.thru != null ? p.thru : p.hole != null ? `*${p.hole}` : '—'
        const mov     = p.movement > 0 ? `<span class="mov-up">▲${p.movement}</span>`
                      : p.movement < 0 ? `<span class="mov-down">▼${Math.abs(p.movement)}</span>` : ''
        const rnd = r => r != null ? `<span class="${scoreClass(isNaN(r) ? 0 : (parseInt(r) > 72 ? 1 : parseInt(r) < 72 ? -1 : 0))}">${r}</span>` : '—'
        return `<tr class="${i===0?'leader':''}">
          <td class="col-pos left">${pos}</td>
          <td class="col-name left">${p.fullName}${p.amateur?'<span class="amateur-badge">A</span>':''}</td>
          <td class="col-tot ${totCls}">${tot}</td>
          <td class="col-r">${rnd(p.r[0])}</td>
          <td class="col-r">${rnd(p.r[1])}</td>
          <td class="col-r">${rnd(p.r[2])}</td>
          <td class="col-r">${rnd(p.r[3])}</td>
          <td class="col-thru">${thruTxt}</td>
          <td class="col-mov">${mov}</td>
        </tr>`
      }).join('')
    }

    // ── main load ─────────────────────────────────────────────────────────────
    async function load() {
      const max = config.maxPlayers || 10
      const entries = []

      // fetch pages one at a time (limit=1 per page — most reliable)
      for (let page = 1; page <= max; page++) {
        try {
          const txt = await fetchText(`${BASE}/competitors?limit=1&page=${page}`)
          const ids  = [...txt.matchAll(/"id":"(\d+)"/g)].map(m => m[1])
          const ords = [...txt.matchAll(/"order":(\d+)/g)].map(m => parseInt(m[1]))
          if (ids.length && ords.length) entries.push({ id: ids[0], order: ords[0] })
        } catch(e) { /* skip */ }
      }

      if (!entries.length) {
        container.querySelector('#m-body').innerHTML =
          '<tr><td colspan="9" style="text-align:center;color:#ff6b6b;padding:20px">⚠️ Failed to load leaderboard</td></tr>'
        return
      }

      // fetch all players in parallel batches of 3
      const players = []
      for (let i = 0; i < entries.length; i += 3) {
        const batch = await Promise.all(entries.slice(i, i+3).map(e => fetchPlayer(e.id, e.order)))
        players.push(...batch.filter(Boolean))
      }

      if (!players.length) {
        container.querySelector('#m-body').innerHTML =
          '<tr><td colspan="9" style="text-align:center;color:#ff6b6b;padding:20px">⚠️ No player data loaded</td></tr>'
        return
      }

      assignPositions(players)
      renderTable(players)

      const statusEl  = container.querySelector('#m-status')
      const updatedEl = container.querySelector('#m-updated')
      if (statusEl)  statusEl.textContent  = 'Masters Tournament · In Progress'
      if (updatedEl) updatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`

      // fetch linescores async after initial render
      for (const p of players) {
        fetchLinescores(p.id).then(rounds => {
          p.r = rounds
          renderTable(players)
        })
      }
    }

    try { await load() } catch(e) {
      const b = container.querySelector('#m-body')
      if (b) b.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ff6b6b;padding:20px">⚠️ ${e.message}</td></tr>`
    }

    // ── auto-refresh ──────────────────────────────────────────────────────────
    const interval = setInterval(() => { load().catch(()=>{}) }, (config.refreshSeconds || 60) * 1000)
    container.__cleanup__ = () => {
      clearInterval(interval)
      const s = document.getElementById(STYLE_ID)
      if (s) s.remove()
    }
  }
})