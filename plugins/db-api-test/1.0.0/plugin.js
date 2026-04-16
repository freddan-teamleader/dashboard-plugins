// @bump: patch
api.registerWidget({
  type: 'db-api-test',
  title: '🧪 DB API Test',
  description: 'Tests api.db — structured table storage',
  height: 400,
  render: async function(container, config) {
    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-secondary);height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:12px">
        <div style="color:var(--text-primary);font-weight:600;font-size:14px">api.db Tests</div>
        <div id="log" style="flex:1;display:flex;flex-direction:column;gap:3px"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="run" style="padding:7px 18px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500">
            ▶ Run tests
          </button>
          <span id="status" style="font-size:12px;color:var(--text-muted)"></span>
        </div>
      </div>`

    const logEl   = container.querySelector('#log')
    const runBtn  = container.querySelector('#run')
    const statusEl = container.querySelector('#status')

    const log = (msg, state = 'ok') => {
      const colors = {
        ok:   { bg: 'rgba(74,222,128,0.12)', border: '#4ade80', text: '#4ade80', icon: '✓' },
        fail: { bg: 'rgba(255,107,107,0.12)', border: '#ff6b6b', text: '#ff6b6b', icon: '✗' },
        info: { bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa', text: '#60a5fa', icon: '→' },
      }
      const c = colors[state] ?? colors.info
      const el = document.createElement('div')
      el.style.cssText = `
        padding:5px 10px;border-radius:5px;font-size:12px;font-family:monospace;
        background:${c.bg};border-left:3px solid ${c.border};color:${c.text};line-height:1.5`
      el.textContent = `${c.icon}  ${msg}`
      logEl.appendChild(el)
      el.scrollIntoView({ block: 'nearest' })
    }

    const run = async () => {
      logEl.innerHTML = ''
      runBtn.disabled = true
      runBtn.textContent = '⏳ Running…'
      statusEl.textContent = ''

      const t0 = Date.now()
      let passed = 0, failed = 0

      const pass = (msg) => { log(msg, 'ok');   passed++ }
      const fail = (msg) => { log(msg, 'fail'); failed++ }

      try {
        // 0 — availability check
        log('Checking api.db availability…', 'info')
        try {
          await api.db.query({})
          pass('api.db is provisioned and reachable')
        } catch(e) {
          if (e.message?.includes('not available')) {
            fail('api.db not provisioned — Edge Function may not be deployed')
            return
          }
          throw e
        }

        // 1 — insert
        log('Test 1: insert', 'info')
        const row = await api.db.insert({ label: 'test-row', value: 42 })
        row?.id
          ? pass(`insert → id ${row.id.slice(0, 8)}…`)
          : fail('insert returned no id')

        // 2 — query all
        log('Test 2: query (all rows)', 'info')
        const all = await api.db.query({})
        all.length >= 1
          ? pass(`query {} → ${all.length} row(s) found`)
          : fail('query returned empty result')

        // 3 — query with filter
        log('Test 3: query with filter', 'info')
        const filtered = await api.db.query({ label: 'test-row' })
        filtered.length >= 1
          ? pass(`query {label:"test-row"} → ${filtered.length} row(s)`)
          : fail('filtered query returned no results')

        // 4 — update
        log('Test 4: update', 'info')
        await api.db.update({ label: 'test-row' }, { value: 99 })
        const updated = await api.db.query({ label: 'test-row' })
        updated[0]?.value === 99
          ? pass('update {value:99} → verified')
          : fail(`update failed — got value: ${JSON.stringify(updated[0]?.value)}`)

        // 5 — delete
        log('Test 5: delete', 'info')
        await api.db.delete({ label: 'test-row' })
        const afterDelete = await api.db.query({ label: 'test-row' })
        afterDelete.length === 0
          ? pass('delete → 0 rows remain')
          : fail(`delete incomplete — ${afterDelete.length} row(s) still present`)

      } catch(e) {
        fail(`unexpected error: ${e.message}`)
      } finally {
        const ms = Date.now() - t0
        const allPassed = failed === 0
        statusEl.textContent = `${passed + failed} tests · ${passed} passed · ${failed} failed · ${ms}ms`
        statusEl.style.color = allPassed ? 'var(--accent-green)' : 'var(--accent-red)'
        runBtn.disabled = false
        runBtn.textContent = '▶ Run again'
      }
    }

    runBtn.onclick = run
  }
})