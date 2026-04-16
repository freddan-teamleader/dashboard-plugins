// @bump: patch
api.registerWidget({
  type: 'db-api-test',
  title: '🧪 DB API Test',
  description: 'Tests api.db — insert, query, update, delete',
  height: 400,
  render: async function(container, config) {
    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-secondary);height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:0">
        <div style="color:var(--text-primary);font-weight:600;margin-bottom:12px;font-size:14px">
          api.db Integration Tests
        </div>
        <div id="log" style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
          <button id="run" style="padding:8px 20px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500">
            ▶ Run Tests
          </button>
          <span id="status" style="font-size:12px;color:var(--text-muted)"></span>
        </div>
      </div>`

    const logEl    = container.querySelector('#log')
    const runBtn   = container.querySelector('#run')
    const statusEl = container.querySelector('#status')

    const log = (msg, ok = true) => {
      const el = document.createElement('div')
      el.style.cssText = [
        'padding:5px 10px',
        'border-radius:5px',
        'font-size:12px',
        'font-family:monospace',
        `background:${ok ? 'rgba(74,222,128,0.10)' : 'rgba(255,107,107,0.12)'}`,
        `color:${ok ? 'var(--accent-green)' : 'var(--accent-red)'}`,
        `border-left:3px solid ${ok ? 'var(--accent-green)' : 'var(--accent-red)'}`,
      ].join(';')
      el.textContent = (ok ? '✓ ' : '✗ ') + msg
      logEl.appendChild(el)
      el.scrollIntoView({ block: 'nearest' })
    }

    const divider = (label) => {
      const el = document.createElement('div')
      el.style.cssText = 'padding:4px 0 2px;font-size:11px;color:var(--text-muted);font-family:monospace;letter-spacing:.05em'
      el.textContent = `── ${label} ──`
      logEl.appendChild(el)
    }

    runBtn.onclick = async () => {
      logEl.innerHTML = ''
      runBtn.disabled = true
      runBtn.textContent = '⏳ Running…'
      statusEl.textContent = ''

      let passed = 0, failed = 0
      const ok  = (msg) => { log(msg, true);  passed++ }
      const err = (msg) => { log(msg, false); failed++ }

      try {
        // ── 0. Availability ──
        divider('0 · availability')
        try {
          await api.db.query({})
          ok('api.db is provisioned and reachable')
        } catch(e) {
          if (e.message?.includes('not available')) {
            err('api.db not provisioned — Edge Function may not have run yet')
            statusEl.textContent = '⚠ db not available'
            runBtn.disabled = false
            runBtn.textContent = '▶ Run Tests'
            return
          }
          throw e
        }

        // ── 1. Insert ──
        divider('1 · insert')
        const row = await api.db.insert({ label: 'db-test', value: 42 })
        row?.id
          ? ok(`row inserted — id: ${row.id.slice(0, 8)}…`)
          : err('insert returned no id')

        // ── 2. Query all ──
        divider('2 · query (no filter)')
        const all = await api.db.query({})
        all.length >= 1
          ? ok(`query returned ${all.length} row(s)`)
          : err('query returned 0 rows after insert')

        // ── 3. Query with filter ──
        divider('3 · query (filter)')
        const filtered = await api.db.query({ label: 'db-test' })
        filtered.length >= 1
          ? ok(`filter {label:"db-test"} → ${filtered.length} row(s)`)
          : err('filter returned no results')

        // ── 4. Update ──
        divider('4 · update')
        await api.db.update({ label: 'db-test' }, { value: 99 })
        const updated = await api.db.query({ label: 'db-test' })
        updated[0]?.value === 99
          ? ok(`value updated: 42 → 99`)
          : err(`value mismatch — got: ${updated[0]?.value}`)

        // ── 5. Delete ──
        divider('5 · delete')
        await api.db.delete({ label: 'db-test' })
        const afterDelete = await api.db.query({ label: 'db-test' })
        afterDelete.length === 0
          ? ok('rows deleted — query returns empty')
          : err(`${afterDelete.length} row(s) still present after delete`)

      } catch(e) {
        err(`unexpected error: ${e.message}`)
      }

      // ── Summary ──
      divider('summary')
      const total = passed + failed
      log(`${passed}/${total} tests passed`, failed === 0)
      statusEl.style.color = failed === 0 ? 'var(--accent-green)' : 'var(--accent-red)'
      statusEl.textContent  = failed === 0 ? `✓ All ${total} passed` : `✗ ${failed} failed`

      runBtn.disabled = false
      runBtn.textContent = '↺ Run Again'
    }
  }
})