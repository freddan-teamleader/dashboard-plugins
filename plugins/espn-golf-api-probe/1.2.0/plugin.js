api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf Probe",
  render: async function(container, config) {
    container.innerHTML = '<p style="color:#94a3b8;padding:12px">Probing summary & alternate endpoints…</p>'
    const log = []
    const out = () => container.innerHTML = `<pre style="color:#e2e8f0;font-size:10px;padding:8px;overflow:auto;height:100%">${log.join('\n')}</pre>`

    const probe = async (label, url) => {
      try {
        const res = await api.fetch(url)
        const text = await res.text()
        log.push(`\n🔍 ${label}`)
        log.push(`URL: ${url}`)
        log.push(`Size: ${text.length} chars`)
        // Try to parse what we can
        try {
          const data = JSON.parse(text)
          log.push(`✅ Valid JSON — keys: ${Object.keys(data).join(', ')}`)
          if (data.athletes) log.push(`athletes count: ${data.athletes.length}, first: ${JSON.stringify(data.athletes[0]).slice(0,300)}`)
          if (data.player) log.push(`player: ${JSON.stringify(data.player).slice(0,300)}`)
          if (data.leaders) log.push(`leaders: ${JSON.stringify(data.leaders).slice(0,300)}`)
          if (data.competitor) log.push(`competitor: ${JSON.stringify(data.competitor).slice(0,300)}`)
          if (data.displayName) log.push(`displayName: ${data.displayName}`)
          if (data.fullName) log.push(`fullName: ${data.fullName}`)
          if (data.value !== undefined) log.push(`value: ${data.value}, displayValue: ${data.displayValue}`)
          if (data.items) log.push(`items[0]: ${JSON.stringify(data.items[0]).slice(0,300)}`)
          if (Array.isArray(data)) log.push(`Array length: ${data.length}, first: ${JSON.stringify(data[0]).slice(0,300)}`)
        } catch(e) {
          // Try partial parse
          log.push(`⚠️ Truncated JSON (${text.length} chars) — first 400:`)
          log.push(text.slice(0, 400))
        }
      } catch(e) {
        log.push(`❌ FETCH ERROR: ${e.message}`)
      }
      out()
    }

    const EVENT = '401811941'
    const BASE  = 'sports.core.api.espn.com/v2/sports/golf/leagues/pga'

    // Try the summary endpoint (well-known ESPN pattern)
    await probe('Summary endpoint', `https://site.api.espn.com/apis/site/v2/sports/golf/pga/summary?event=${EVENT}`)

    // Try scoreboard with smaller limit
    await probe('Scoreboard limit=1', `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?limit=1`)

    // Try competitor with embed params
    await probe('Competitor ?enable=', `https://${BASE}/events/${EVENT}/competitions/${EVENT}/competitors/9938?enable=athlete,score,status,linescores`)

    // Try the score endpoint with text size reduction  
    await probe('Score only (small?)', `https://${BASE}/events/${EVENT}/competitions/${EVENT}/competitors/9938/score`)

    // Try a known small athlete endpoint
    await probe('Athlete headshot only', `https://${BASE}/seasons/2026/athletes/9938/headshot`)

    // Try page 1 competitors with limit=5 to see inline order data
    await probe('Competitors page1 limit=5', `https://${BASE}/events/${EVENT}/competitions/${EVENT}/competitors?limit=5&page=1`)

    log.push('\n✅ Done')
    out()
  }
})