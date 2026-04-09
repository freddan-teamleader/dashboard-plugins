// @bump: patch
api.registerWidget({
  type: "golf-masters-2026",
  title: "The Masters 2026",
  description: "Live leaderboard probe — athlete name debug",
  height: 400,
  defaultConfig: { maxPlayers: 10, refreshSeconds: 60 },
  render: async function(container, config) {
    container.innerHTML = '<pre style="color:#e2e8f0;font-size:11px;padding:8px;overflow:auto;height:100%">Probing athlete fetch...</pre>'
    const pre = container.querySelector('pre')
    const log = msg => { pre.textContent += '\n' + msg }

    const BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
    const EVENT = '401811941'

    // Step 1: get competitor ID from page 1
    const compRes = await api.fetch(`${BASE}/events/${EVENT}/competitions/${EVENT}/competitors?limit=3&page=1`)
    const compData = await compRes.json()
    const first = compData.items[0]
    const id = first.id
    log(`Competitor ID: ${id}`)
    log(`Order: ${first.order}`)

    // Step 2: fetch athlete directly
    const athleteUrl = `${BASE}/seasons/2026/athletes/${id}`
    log(`\nFetching athlete: ${athleteUrl}`)
    try {
      const aRes = await api.fetch(athleteUrl)
      log(`HTTP status: ${aRes.status}`)
      const txt = await aRes.text()
      log(`Response size: ${txt.length} chars`)
      log(`First 500 chars:\n${txt.substring(0, 500)}`)
      try {
        const aData = JSON.parse(txt)
        log(`\nParsed OK!`)
        log(`fullName: ${aData.fullName}`)
        log(`shortName: ${aData.shortName}`)
        log(`displayName: ${aData.displayName}`)
      } catch(e) {
        log(`JSON parse error: ${e.message}`)
      }
    } catch(e) {
      log(`Fetch error: ${e.message}`)
    }

    // Step 3: try alternate athlete URL format
    const altUrl = `https://site.api.espn.com/apis/common/v3/sports/golf/pga/athletes/${id}`
    log(`\nTrying alternate URL: ${altUrl}`)
    try {
      const aRes2 = await api.fetch(altUrl)
      log(`HTTP status: ${aRes2.status}`)
      const txt2 = await aRes2.text()
      log(`Response size: ${txt2.length} chars`)
      log(`First 300 chars:\n${txt2.substring(0, 300)}`)
    } catch(e) {
      log(`Fetch error: ${e.message}`)
    }

    // Step 4: try the $ref URL from the competitor directly
    const refUrl = first.athlete['$ref']
    log(`\nTrying $ref URL: ${refUrl}`)
    try {
      const aRes3 = await api.fetch(refUrl)
      log(`HTTP status: ${aRes3.status}`)
      const txt3 = await aRes3.text()
      log(`Response size: ${txt3.length} chars`)
      log(`First 300 chars:\n${txt3.substring(0, 300)}`)
    } catch(e) {
      log(`Fetch error: ${e.message}`)
    }
  }
})