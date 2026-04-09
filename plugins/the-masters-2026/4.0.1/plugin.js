// @bump: patch
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard from ESPN API",
  height: 500,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  render: async function(container, config) {
    const EVENT_ID = '401811941'
    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const COMP = `${BASE}/events/${EVENT_ID}/competitions/${EVENT_ID}`

    const bg = '#0f172a', card = '#1e293b', gold = '#f5c842', green = '#4ade80'
    const red = '#ff6b6b', muted = '#94a3b8', white = '#e2e8f0'

    container.innerHTML = `
      <div style="background:${bg};height:100%;display:flex;flex-direction:column;font-family:Georgia,serif;overflow:hidden">
        <div style="background:linear-gradient(135deg,#1a3a1a,#2d5a2d);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">⛳</span>
            <div>
              <div style="color:${gold};font-size:14px;font-weight:bold;letter-spacing:1px">THE MASTERS 2026</div>
              <div style="color:#86efac;font-size:10px">Augusta National · Live Leaderboard</div>
            </div>
          </div>
          <div id="status-badge" style="color:${muted};font-size:10px">Loading…</div>
        </div>
        <div style="display:grid;grid-template-columns:32px 1fr 48px 36px 36px 36px 36px 42px;gap:0;padding:4px 8px;background:#0a1628;flex-shrink:0">
          ${['POS','PLAYER','TOT','R1','R2','R3','R4','THRU'].map(h =>
            `<div style="color:${muted};font-size:9px;font-weight:bold;text-align:center;padding:2px 0">${h}</div>`
          ).join('')}
        </div>
        <div id="lb-body" style="flex:1;overflow-y:auto">
          <div style="color:${muted};text-align:center;padding:20px;font-size:12px">Fetching leaderboard…</div>
        </div>
        <div id="lb-footer" style="padding:4px 10px;background:#0a1628;color:${muted};font-size:9px;text-align:right;flex-shrink:0"></div>
      </div>`

    const fetchText = async (url) => {
      const r = await api.fetch(url)
      return r.text()
    }
    const fetchJSON = async (url) => {
      const r = await api.fetch(url)
      return r.json()
    }

    const scoreColor = (v) => {
      if (v === null || v === undefined || v === 'E') return white
      const n = parseInt(v)
      if (isNaN(n)) return white
      if (n < 0) return green
      if (n > 0) return red
      return white
    }
    const fmtScore = (v) => {
      if (v === null || v === undefined) return '-'
      const n = parseInt(v)
      if (isNaN(n)) return v
      if (n === 0) return 'E'
      return n > 0 ? `+${n}` : `${n}`
    }

    let refreshTimer = null

    const load = async () => {
      try {
        const maxPlayers = config.maxPlayers || 10
        const pages = Math.ceil(maxPlayers / 5)

        // Step 1: fetch player IDs via raw text + regex, page by page
        let allEntries = []
        for (let page = 1; page <= pages; page++) {
          const url = `${COMP}/competitors?limit=5&page=${page}`
          const txt = await fetchText(url)
          console.log(`Page ${page} raw (${txt.length} chars):`, txt.substring(0, 200))

          // Extract id:"XXX" and order:N pairs
          const idMatches = [...txt.matchAll(/"id":"(\d+)"/g)].map(m => m[1])
          const orderMatches = [...txt.matchAll(/"order":(\d+)/g)].map(m => parseInt(m[1]))

          console.log(`Page ${page} ids:`, idMatches, 'orders:', orderMatches)

          // Skip first id/order if they belong to the pagination wrapper (count, pageIndex etc don't have ids)
          // The wrapper has no "id" field — safe to use all matches
          for (let i = 0; i < idMatches.length; i++) {
            const id = idMatches[i]
            const order = orderMatches[i] ?? (allEntries.length + i + 1)
            if (allEntries.length < maxPlayers) {
              allEntries.push({ id, order })
            }
          }
        }

        console.log('All entries:', allEntries)

        if (!allEntries.length) throw new Error('No competitors found')

        // Step 2: fetch score + status + athlete for each player in parallel
        const players = await Promise.all(allEntries.map(async ({ id, order }) => {
          try {
            const [scoreDat, statusDat, athleteTxt] = await Promise.all([
              fetchJSON(`${COMP}/competitors/${id}/score`),
              fetchJSON(`${COMP}/competitors/${id}/status`),
              fetchText(`${BASE}/seasons/2026/athletes/${id}`)
            ])

            // Extract name from raw text via regex
            const nameMatch = athleteTxt.match(/"fullName":"([^"]+)"/)
            const name = nameMatch ? nameMatch[1] : `Player ${id}`

            const flagMatch = athleteTxt.match(/"flag":\{"href":"([^"]+)"/)
            const flagUrl = flagMatch ? flagMatch[1] : null

            const totalDisplay = scoreDat.displayValue ?? 'E'
            const totalValue = scoreDat.value ?? 0

            const pos = statusDat.position?.displayName ?? `${order}`
            const isTie = statusDat.position?.isTie ?? false
            const thru = statusDat.thru ?? 0
            const statusState = statusDat.type?.state ?? 'pre'
            const movement = 0

            return { id, order, name, flagUrl, totalDisplay, totalValue, pos, isTie, thru, statusState, movement, rounds: [] }
          } catch (e) {
            console.warn(`Failed player ${id}:`, e)
            return null
          }
        }))

        const valid = players.filter(Boolean).sort((a, b) => a.order - b.order)
        console.log('Valid players:', valid.map(p => `${p.order}. ${p.name} ${p.totalDisplay}`))

        if (!valid.length) throw new Error('No player data loaded')

        renderTable(valid)

        // Step 3: load linescores async
        valid.forEach(async (p) => {
          try {
            const ls = await fetchJSON(`${COMP}/competitors/${p.id}/linescores`)
            if (ls.items) {
              p.rounds = ls.items.map(r => r.displayValue ?? '-')
              updateRow(p)
            }
          } catch (e) {}
        })

        document.getElementById('lb-footer').textContent = `Updated ${new Date().toLocaleTimeString()}`

      } catch (e) {
        document.getElementById('lb-body').innerHTML =
          `<div style="color:${red};text-align:center;padding:20px;font-size:12px">⚠️ ${e.message}</div>`
        console.error(e)
      }
    }

    const renderTable = (players) => {
      const body = document.getElementById('lb-body')
      if (!body) return
      body.innerHTML = ''
      players.forEach(p => {
        const row = document.createElement('div')
        row.id = `row-${p.id}`
        row.style.cssText = `display:grid;grid-template-columns:32px 1fr 48px 36px 36px 36px 36px 42px;gap:0;padding:5px 8px;border-bottom:1px solid #1e293b;align-items:center`
        row.innerHTML = rowHTML(p)
        body.appendChild(row)
      })
    }

    const rowHTML = (p) => {
      const posStr = p.isTie ? `T${p.pos}` : `${p.pos}`
      const mv = p.movement > 0 ? `<span style="color:${green}">▲</span>` :
                 p.movement < 0 ? `<span style="color:${red}">▼</span>` : ''
      const tot = fmtScore(p.totalDisplay)
      const totColor = scoreColor(p.totalDisplay)
      const thruStr = p.statusState === 'post' ? 'F' : p.thru === 0 ? '-' : `${p.thru}`
      const r = p.rounds
      return `
        <div style="color:${gold};font-size:11px;font-weight:bold;text-align:center">${posStr}</div>
        <div style="display:flex;align-items:center;gap:4px">
          ${mv}
          <span style="color:${white};font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span>
        </div>
        <div style="color:${totColor};font-size:12px;font-weight:bold;text-align:center">${tot}</div>
        <div style="color:${muted};font-size:10px;text-align:center">${r[0] ?? '-'}</div>
        <div style="color:${muted};font-size:10px;text-align:center">${r[1] ?? '-'}</div>
        <div style="color:${muted};font-size:10px;text-align:center">${r[2] ?? '-'}</div>
        <div style="color:${muted};font-size:10px;text-align:center">${r[3] ?? '-'}</div>
        <div style="color:${muted};font-size:10px;text-align:center">${thruStr}</div>`
    }

    const updateRow = (p) => {
      const row = document.getElementById(`row-${p.id}`)
      if (row) row.innerHTML = rowHTML(p)
    }

    await load()

    const interval = (config.refreshSeconds || 60) * 1000
    refreshTimer = setInterval(load, interval)

    container.__cleanup__ = () => {
      if (refreshTimer) clearInterval(refreshTimer)
    }
  }
})