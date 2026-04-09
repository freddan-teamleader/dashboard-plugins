// @bump: major
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live Masters Tournament leaderboard via ESPN API",
  height: 520,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },

  render: async function(container, config) {
    const EVENT = '401811941'
    const BASE  = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const COMP  = `${BASE}/events/${EVENT}/competitions/${EVENT}`
    const max   = config.maxPlayers || 10
    const refreshSecs = config.refreshSeconds || 60

    const s = document.createElement('style')
    s.textContent = `
      .masters-wrap { font-family: 'Georgia', serif; background: #0a1628; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
      .masters-header { background: linear-gradient(135deg, #1a3a1a 0%, #0d2b0d 100%); border-bottom: 2px solid #c9a84c; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
      .masters-logo { display: flex; align-items: center; gap: 8px; }
      .masters-logo .flag { font-size: 22px; }
      .masters-title { font-size: 14px; font-weight: bold; color: #c9a84c; letter-spacing: 1px; text-transform: uppercase; }
      .masters-subtitle { font-size: 10px; color: #94a3b8; letter-spacing: 0.5px; }
      .masters-status { font-size: 10px; color: #4ade80; text-align: right; }
      .masters-status.err { color: #ff6b6b; }
      .masters-table { flex: 1; overflow-y: auto; }
      .masters-table::-webkit-scrollbar { width: 4px; }
      .masters-table::-webkit-scrollbar-track { background: #0a1628; }
      .masters-table::-webkit-scrollbar-thumb { background: #c9a84c55; border-radius: 2px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      thead th { background: #0d2b0d; color: #c9a84c; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 8px; position: sticky; top: 0; z-index: 1; font-weight: normal; border-bottom: 1px solid #c9a84c44; }
      tbody tr { border-bottom: 1px solid #1e3a5f22; transition: background 0.15s; }
      tbody tr:hover { background: #1a3a1a55; }
      tbody tr.leader { background: #1a3a1a33; }
      td { padding: 5px 8px; vertical-align: middle; }
      .td-pos { width: 36px; text-align: center; color: #94a3b8; font-size: 11px; }
      .td-pos.first { color: #c9a84c; font-weight: bold; }
      .td-name { font-size: 12px; color: #e2e8f0; }
      .td-name .country { font-size: 9px; color: #64748b; margin-left: 4px; }
      .td-score { text-align: center; font-weight: bold; font-size: 13px; width: 44px; }
      .score-neg { color: #4ade80; }
      .score-pos { color: #ff6b6b; }
      .score-e   { color: #e2e8f0; }
      .td-round  { text-align: center; color: #94a3b8; width: 28px; font-size: 11px; }
      .td-round.active { color: #60a5fa; font-weight: bold; }
      .td-thru { text-align: center; color: #64748b; width: 36px; font-size: 10px; }
      .td-move { text-align: center; width: 28px; font-size: 10px; }
      .move-up { color: #4ade80; }
      .move-dn { color: #ff6b6b; }
      .move-nc { color: #64748b; }
      .masters-footer { background: #0d2b0d; border-top: 1px solid #c9a84c33; padding: 4px 12px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
      .footer-note { font-size: 9px; color: #64748b; }
      .footer-updated { font-size: 9px; color: #94a3b8; }
      .skeleton { animation: pulse 1.5s ease-in-out infinite; background: #1e3a5f; border-radius: 3px; display: inline-block; }
      @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }
    `
    container.innerHTML = ''
    container.appendChild(s)

    const wrap = document.createElement('div')
    wrap.className = 'masters-wrap'
    wrap.innerHTML = `
      <div class="masters-header">
        <div class="masters-logo">
          <span class="flag">⛳</span>
          <div>
            <div class="masters-title">The Masters 2026</div>
            <div class="masters-subtitle">Augusta National · April 9–12</div>
          </div>
        </div>
        <div class="masters-status" id="m-status">Loading…</div>
      </div>
      <div class="masters-table"><table>
        <thead><tr>
          <th>POS</th><th style="text-align:left">PLAYER</th>
          <th>TOT</th><th>R1</th><th>R2</th><th>R3</th><th>R4</th>
          <th>THRU</th><th>MOV</th>
        </tr></thead>
        <tbody id="m-body"></tbody>
      </table></div>
      <div class="masters-footer">
        <span class="footer-note">🟢 Live · ESPN API</span>
        <span class="footer-updated" id="m-updated">–</span>
      </div>
    `
    container.appendChild(wrap)

    const statusEl  = wrap.querySelector('#m-status')
    const tbody     = wrap.querySelector('#m-body')
    const updatedEl = wrap.querySelector('#m-updated')

    // ── helpers ──────────────────────────────────────────────────────────
    const fetchText = async (url) => {
      const r = await api.fetch(url)
      return r.text()
    }
    const fetchJSON = async (url) => {
      const r = await api.fetch(url)
      return r.json()
    }
    const regexVal = (text, key) => {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`) )
      return m ? m[1] : null
    }
    const scoreClass = (v) => {
      if (v === 'E' || v === '0') return 'score-e'
      return (v && v.startsWith('-')) ? 'score-neg' : 'score-pos'
    }
    const fmtScore = (v) => (!v || v === '0') ? 'E' : v

    // ── skeleton rows ────────────────────────────────────────────────────
    const showSkeleton = (n) => {
      tbody.innerHTML = Array.from({length: n}, (_, i) => `
        <tr>
          <td class="td-pos"><span class="skeleton" style="width:20px;height:12px"></span></td>
          <td class="td-name"><span class="skeleton" style="width:${90+i%3*20}px;height:12px"></span></td>
          <td class="td-score"><span class="skeleton" style="width:24px;height:12px"></span></td>
          <td class="td-round"></td><td class="td-round"></td>
          <td class="td-round"></td><td class="td-round"></td>
          <td class="td-thru"></td><td class="td-move"></td>
        </tr>`).join('')
    }
    showSkeleton(max)

    // ── fetch competitor IDs via raw text + regex ────────────────────────
    const fetchIDs = async (maxP) => {
      const pages = Math.ceil(maxP / 5)
      const ids = [], orders = []
      for (let p = 1; p <= pages; p++) {
        const url  = `${COMP}/competitors?limit=5&page=${p}`
        const text = await fetchText(url)
        const foundIDs    = [...text.matchAll(/"id"\s*:\s*"(\d+)"/g)].map(m => m[1])
        const foundOrders = [...text.matchAll(/"order"\s*:\s*(\d+)/g)].map(m => parseInt(m[1]))
        // pair them up — each item has id then order in sequence
        // extract per-item blocks
        const items = text.split('"type":"athlete"')
        items.shift() // remove header
        items.forEach((block, i) => {
          const idM  = block.match(/"id"\s*:\s*"(\d+)"/)
          const ordM = block.match(/"order"\s*:\s*(\d+)/)
          if (idM) {
            const id  = idM[1]
            const ord = ordM ? parseInt(ordM[1]) : (p-1)*5 + i + 1
            if (!ids.includes(id)) { ids.push(id); orders.push(ord) }
          }
        })
        if (ids.length >= maxP) break
      }
      return ids.slice(0, maxP).map((id, i) => ({ id, order: orders[i] || i+1 }))
    }

    // ── fetch one player's data ──────────────────────────────────────────
    const fetchPlayer = async ({ id, order }) => {
      const [scoreData, statusData, athleteText] = await Promise.all([
        fetchJSON(`${COMP}/competitors/${id}/score`).catch(() => null),
        fetchJSON(`${COMP}/competitors/${id}/status`).catch(() => null),
        fetchText(`${BASE}/seasons/2026/athletes/${id}`).catch(() => ''),
      ])

      const name    = regexVal(athleteText, 'fullName')  || regexVal(athleteText, 'displayName') || `Player ${id}`
      const country = regexVal(athleteText, 'citizenship') || ''
      const score   = scoreData ? fmtScore(scoreData.displayValue) : 'E'
      const pos     = statusData?.position
      const posStr  = pos ? (pos.isTie ? `T${pos.displayName}` : pos.displayName) : `${order}`
      const thru    = statusData?.type?.state === 'post' ? 'F'
                    : statusData?.thru != null ? (statusData.thru === 0 ? '-' : statusData.thru)
                    : '-'
      const period  = statusData?.period || 1
      const move    = statusData ? (statusData.type?.state === 'pre' ? 0 : null) : null

      return { id, order, name, country, score, posStr, thru, period, move, rounds: [] }
    }

    // ── fetch linescores async ───────────────────────────────────────────
    const fetchLinescores = async (id) => {
      try {
        const data = await fetchJSON(`${COMP}/competitors/${id}/linescores`)
        return (data.items || []).map(r => r.displayValue || '-')
      } catch { return [] }
    }

    // ── render table rows ────────────────────────────────────────────────
    const renderRows = (players) => {
      tbody.innerHTML = players.map((p, i) => {
        const sc   = scoreClass(p.score)
        const isFirst = p.posStr === '1'
        const moveHtml = p.move > 0 ? `<span class="move-up">▲${p.move}</span>`
                       : p.move < 0 ? `<span class="move-dn">▼${Math.abs(p.move)}</span>`
                       : `<span class="move-nc">—</span>`
        const rnd = (idx) => {
          const v = p.rounds[idx]
          if (!v) return `<td class="td-round ${p.period === idx+1 ? 'active' : ''}">–</td>`
          return `<td class="td-round ${p.period === idx+1 ? 'active' : ''}">${v}</td>`
        }
        return `<tr class="${isFirst ? 'leader' : ''}">
          <td class="td-pos ${isFirst ? 'first' : ''}">${p.posStr}</td>
          <td class="td-name">${p.name}<span class="country">${p.country}</span></td>
          <td class="td-score ${sc}">${p.score}</td>
          ${rnd(0)}${rnd(1)}${rnd(2)}${rnd(3)}
          <td class="td-thru">${p.thru}</td>
          <td class="td-move">${moveHtml}</td>
        </tr>`
      }).join('')
    }

    // ── main load ────────────────────────────────────────────────────────
    let timer = null
    const load = async () => {
      try {
        statusEl.className = 'masters-status'
        statusEl.textContent = 'Fetching…'

        const competitors = await fetchIDs(max)
        const players = await Promise.all(competitors.map(fetchPlayer))
        players.sort((a, b) => a.order - b.order)

        renderRows(players)
        statusEl.textContent = 'Live ●'
        updatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`

        // load linescores in background
        players.forEach(async (p, i) => {
          p.rounds = await fetchLinescores(p.id)
          renderRows(players)
        })

      } catch (err) {
        statusEl.className = 'masters-status err'
        statusEl.textContent = '⚠ Error'
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:#ff6b6b">
          ⚠️ Failed to load leaderboard<br><small style="color:#64748b">${err.message}</small>
        </td></tr>`
      }
    }

    await load()
    timer = setInterval(load, (config.refreshSeconds || 60) * 1000)

    container.__cleanup__ = () => { if (timer) clearInterval(timer) }
  }
})