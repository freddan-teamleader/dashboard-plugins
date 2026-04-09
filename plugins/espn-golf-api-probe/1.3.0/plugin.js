api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf API Probe",
  height: 400,
  render: async function(container, config) {
    container.innerHTML = `<pre style="color:#e2e8f0;font-size:11px;padding:8px;overflow:auto;height:100%">Probing athlete endpoints...</pre>`
    const pre = container.querySelector('pre')
    const log = s => { pre.textContent += '\n' + s }

    const athleteId = '9938'

    // Test 1: Raw text, don't parse JSON, just show first 500 chars
    try {
      const res = await api.fetch(`https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/${athleteId}?lang=en&region=us`)
      const text = await res.text()
      log(`=== RAW ATHLETE TEXT (first 500 chars) ===`)
      log(`Total size: ${text.length}`)
      log(text.substring(0, 500))
    } catch(e) { log(`❌ ERROR: ${e.message}`) }

    // Test 2: Site API athlete
    try {
      const res = await api.fetch(`https://site.api.espn.com/apis/common/v3/sports/golf/pga/athletes/${athleteId}`)
      const text = await res.text()
      log(`\n=== SITE API ATHLETE (first 500 chars) ===`)
      log(`Total size: ${text.length}`)
      log(text.substring(0, 500))
      if (text.length < 5000) {
        try { const j = JSON.parse(text); log(`Keys: ${Object.keys(j).join(', ')}`) } catch(e) {}
      }
    } catch(e) { log(`❌ ERROR: ${e.message}`) }

    // Test 3: Try fetching just first 400 chars and manually extract name
    try {
      const res = await api.fetch(`https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/${athleteId}?lang=en&region=us`)
      const text = await res.text()
      const fnMatch = text.match(/"firstName":"([^"]+)"/)
      const lnMatch = text.match(/"lastName":"([^"]+)"/)
      const fullMatch = text.match(/"fullName":"([^"]+)"/)
      const shortMatch = text.match(/"shortName":"([^"]+)"/)
      log(`\n=== REGEX EXTRACTION ===`)
      log(`firstName: ${fnMatch ? fnMatch[1] : 'NOT FOUND'}`)
      log(`lastName: ${lnMatch ? lnMatch[1] : 'NOT FOUND'}`)
      log(`fullName: ${fullMatch ? fullMatch[1] : 'NOT FOUND'}`)
      log(`shortName: ${shortMatch ? shortMatch[1] : 'NOT FOUND'}`)
    } catch(e) { log(`❌ REGEX ERROR: ${e.message}`) }
  }
})