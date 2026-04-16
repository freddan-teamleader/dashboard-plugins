api.registerWidget({
  type: 'db-api-test',
  title: '🧪 DB API Test',
  description: 'Tests api.db — structured table storage',
  height: 400,
  render: async function(container, config) {
    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-secondary);height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:0">
        <div style="color:var(--text-primary);font-weight:600;margin-bottom:12px;font-size:14px">🧪 api.db Test Suite</div>
        <div id="log" style="flex:1;overflow:auto"></div>
        <button id="run" style="margin-top:12px;padding:8px 16px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;align-self:flex-start">
          ▶ Run Tests
        </button>
      </div>`

    const logEl = container.querySelector('#log')
    const btn   = container.querySelector('#run')

    const log = (msg, ok = true) => {
      const el = document.createElement('div')
      el.style.cssText = `
        padding:4px 8px;margin:2px 0;border-radius:4px;font-size:12px;
        font-family:monospace;
        background:${ok ? 'rgba(74,222,128,0.12)' : 'rgba(255,107,107,0.12)'};
        color:${ok ? 'var(--accent-green)' : 'var(--accent-red)'};
        border-left:3px solid ${ok ? 'var(--accent-green)' : 'var(--accent-red)'};
      `
      el.textContent = (ok ? '✓ ' : '✗ ') + msg
      logEl.appendChild(el)
      logEl.scrollTop = logEl.scrollHeight
    }

    const logSection = (title) => {
      const el = document.createElement('div')
      el.style.cssText = `
        padding:6px 8px 2px;margin-top:8px;font-size:11px;font-weight:600;
        font-family:monospace;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:0.05em;
      `
      el.textContent = '— ' + title + ' —'
      logEl.appendChild(el)
    }

    const timer = (label, fn) => async (...args) => {
      const t0 = performance.now()
      const result = await fn(...args)
      const ms = (performance.now() - t0).toFixed(1)
      return { result, ms }
    }

    btn.onclick = async () => {
      logEl.innerHTML = ''
      btn.disabled = true
      btn.textContent = '⏳ Running…'

      try {
        // ── 0. Availability ──────────────────────────────────────────
        logSection('0 · availability')
        try {
          const t0 = performance.now()
          await api.db.query({})
          log(`api.db available (${(performance.now()-t0).toFixed(1)} ms)`)
        } catch(e) {
          log('api.db not available — ' + e.message, false)
          btn.disabled = false
          btn.textContent = '▶ Run Again'
          return
        }

        // ── 1. Insert ────────────────────────────────────────────────
        logSection('1 · insert')
        const t1 = performance.now()
        const row = await api.db.insert({ label: 'db-test', value: 42, note: 'hello' })
        const ins_ms = (performance.now()-t1).toFixed(1)
        if (row?.id) {
          log(`row created  id=${row.id.slice(0,8)}… (${ins_ms} ms)`)
          log(`fields present: label="${row.label}", value=${row.value}, note="${row.note}"`,
              row.label === 'db-test' && row.value === 42 && row.note === 'hello')
        } else {
          log(`insert returned no id (${ins_ms} ms)`, false)
        }

        // ── 2. Query all ─────────────────────────────────────────────
        logSection('2 · query — no filter')
        const t2 = performance.now()
        const all = await api.db.query({})
        log(`${all.length} row(s) found (${(performance.now()-t2).toFixed(1)} ms)`, all.length >= 1)

        // ── 3. Query with filter ─────────────────────────────────────
        logSection('3 · query — filter')
        const t3 = performance.now()
        const filtered = await api.db.query({ label: 'db-test' })
        log(`filter {label:"db-test"} → ${filtered.length} row(s) (${(performance.now()-t3).toFixed(1)} ms)`,
            filtered.length >= 1)

        // ── 4. Query with orderBy + limit ─────────────────────────────
        logSection('4 · query — orderBy + limit')
        const t4 = performance.now()
        let ordered = null, orderErr = null
        try {
          ordered = await api.db.query({}, { orderBy: 'value', ascending: true, limit: 5 })
          log(`orderBy:"value" asc, limit:5 → ${ordered.length} row(s) (${(performance.now()-t4).toFixed(1)} ms)`,
              ordered.length <= 5)
        } catch(e) {
          log('orderBy/limit threw: ' + e.message, false)
        }

        // ── 5. Update ────────────────────────────────────────────────
        logSection('5 · update')
        const t5 = performance.now()
        await api.db.update({ label: 'db-test' }, { value: 99 })
        const afterUpdate = await api.db.query({ label: 'db-test' })
        const allUpdated = afterUpdate.every(r => r.value === 99)
        log(`update {value:99} → ${afterUpdate.length} row(s) updated, all value=99: ${allUpdated} (${(performance.now()-t5).toFixed(1)} ms)`,
            afterUpdate.length >= 1 && allUpdated)

        // ── 6. Update returns changed rows ───────────────────────────
        logSection('6 · update — verify note unchanged')
        const notesOk = afterUpdate.every(r => r.note === 'hello')
        log(`untouched field note still "hello": ${notesOk}`, notesOk)

        // ── 7. Delete ────────────────────────────────────────────────
        logSection('7 · delete')
        const t7 = performance.now()
        await api.db.delete({ label: 'db-test' })
        const afterDelete = await api.db.query({ label: 'db-test' })
        log(`delete {label:"db-test"} → ${afterDelete.length} rows remain (${(performance.now()-t7).toFixed(1)} ms)`,
            afterDelete.length === 0)

        // ── Summary ───────────────────────────────────────────────────
        const pass  = logEl.querySelectorAll('[style*="accent-green"]').length
        const fail  = logEl.querySelectorAll('[style*="accent-red"]').length
        const total = pass + fail
        logSection(`done — ${pass}/${total} passed`)

      } catch(e) {
        log('unexpected error: ' + e.message, false)
        console.error('[db-api-test]', e)
      }

      btn.disabled = false
      btn.textContent = '▶ Run Again'
    }
  }
})