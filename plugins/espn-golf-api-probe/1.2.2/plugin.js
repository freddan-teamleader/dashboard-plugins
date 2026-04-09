// @bump: patch
api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf API Probe",
  description: "Probes ESPN Golf API endpoints",
  height: 600,
  render: async function(container, config) {
    const BASE = 'http://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const EVT  = '401811941'
    const log  = []
    const out  = () => container.innerHTML = `<pre style="color:#e2e8f0;font-size:11px;padding:8px;white-space:pre-wrap">${log.join('\n')}</pre>`

    const fetchJ = async (url) => {
      const r = await api.fetch(url)
      const t = await r.text()
      return { text: t, size: t.length, json: JSON.parse(t) }
    }

    container.innerHTML = '<pre style="color:#e2e8f0;font-size:11px;padding:8px">Probing...</pre>'

    // Test 1: Status endpoint for competitor 9938
    try {
      log.push('=== STATUS endpoint ===')
      const { json, size } = await fetchJ(`${BASE}/events/${EVT}/competitions/${EVT}/competitors/9938/status`)
      log.push(`Size: ${size} chars`)
      log.push(`Keys: ${Object.keys(json).join(', ')}`)
      log.push(JSON.stringify(json, null, 2).slice(0, 600))
    } catch(e) { log.push(`❌ ${e.message}`) }
    out()

    // Test 2: Athlete summary (shorter URL pattern)
    try {
      log.push('\n=== ATHLETE summary endpoint ===')
      const { json, size } = await fetchJ(`${BASE}/seasons/2026/athletes/9938/profile`)
      log.push(`Size: ${size} chars`)
      log.push(`Keys: ${Object.keys(json).join(', ')}`)
      log.push(JSON.stringify(json, null, 2).slice(0, 400))
    } catch(e) { log.push(`❌ ${e.message}`) }
    out()

    // Test 3: Athlete base endpoint — maybe short enough?
    try {
      log.push('\n=== ATHLETE base endpoint ===')
      const { json, size } = await fetchJ(`${BASE}/seasons/2026/athletes/9938`)
      log.push(`Size: ${size} chars`)
      log.push(`Keys: ${Object.keys(json).join(', ')}`)
      log.push(JSON.stringify(json, null, 2).slice(0, 600))
    } catch(e) { log.push(`❌ ${e.message}`) }
    out()

    // Test 4: Linescores — how big?
    try {
      log.push('\n=== LINESCORES endpoint ===')
      const { json, size } = await fetchJ(`${BASE}/events/${EVT}/competitions/${EVT}/competitors/9938/linescores`)
      log.push(`Size: ${size} chars`)
      log.push(`Keys: ${Object.keys(json).join(', ')}`)
      log.push(JSON.stringify(json, null, 2).slice(0, 800))
    } catch(e) { log.push(`❌ ${e.message}`) }
    out()

    // Test 5: Fetch competitors page 1 limit=10 — does 'order' field come inline?
    try {
      log.push('\n=== COMPETITORS page1 limit=10 — check for inline name ===')
      const { json, size } = await fetchJ(`${BASE}/events/${EVT}/competitions/${EVT}/competitors?limit=10&page=1`)
      log.push(`Size: ${size} chars`)
      const first = json.items[0]
      log.push(`item[0] keys: ${Object.keys(first).join(', ')}`)
      log.push(`order: ${first.order}`)
      // Check if there's anything useful inline
      log.push(JSON.stringify(first, null, 2).slice(0, 400))
    } catch(e) { log.push(`❌ ${e.message}`) }
    out()
  }
})