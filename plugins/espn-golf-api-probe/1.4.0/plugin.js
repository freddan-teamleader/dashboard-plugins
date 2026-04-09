api.registerWidget({
  type: "espn-golf-probe",
  title: "ESPN Golf Probe",
  height: 400,
  render: async function(container, config) {
    container.innerHTML = '<pre style="color:#e2e8f0;font-size:11px;padding:8px;overflow:auto;height:100%">Probing...</pre>'
    const pre = container.querySelector('pre')
    const log = s => { pre.textContent += s + '\n' }

    const base = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811941/competitions/401811941'

    // Test 1: competitors limit=1
    try {
      const r = await api.fetch(`${base}/competitors?limit=1&page=1`)
      const text = await r.text()
      log(`=== competitors limit=1 ===`)
      log(`Size: ${text.length}`)
      log(`First 600:\n${text.slice(0, 600)}`)
    } catch(e) { log(`❌ ${e.message}`) }

    // Test 2: competitors limit=1 page=1 — raw first item $ref URL fetched as text
    try {
      const r = await api.fetch(`${base}/competitors?limit=1&page=1`)
      const text = await r.text()
      // extract first $ref URL with regex
      const match = text.match(/"items":\[{"\\$ref":"([^"]+)"/)
      if (match) {
        log(`\n=== First competitor $ref URL ===\n${match[1]}`)
        const r2 = await api.fetch(match[1])
        const t2 = await r2.text()
        log(`Size: ${t2.length}`)
        log(`First 400:\n${t2.slice(0, 400)}`)
      } else {
        log(`No $ref match found`)
        // try alternate regex
        const m2 = text.match(/\$ref.*?competitors\/(\d+)/)
        log(`Alt match: ${m2 ? m2[1] : 'none'}`)
        log(`Raw text:\n${text.slice(0, 800)}`)
      }
    } catch(e) { log(`❌ ${e.message}`) }

    // Test 3: try fetching competitors as raw text and regex out all IDs + order values
    try {
      const r = await api.fetch(`${base}/competitors?limit=5&page=1`)
      const text = await r.text()
      log(`\n=== competitors limit=5 raw text ===`)
      log(`Size: ${text.length}`)
      // Extract IDs and order values via regex
      const ids = [...text.matchAll(/"id":"(\d+)"/g)].map(m => m[1])
      const orders = [...text.matchAll(/"order":(\d+)/g)].map(m => m[1])
      log(`IDs found: ${ids.join(', ')}`)
      log(`Orders found: ${orders.join(', ')}`)
    } catch(e) { log(`❌ ${e.message}`) }
  }
})