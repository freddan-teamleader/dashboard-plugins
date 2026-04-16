api.registerWidget({
  type: 'db-api-test',
  title: '🧪 DB API Test',
  description: 'Tests api.db — insert, query, update, delete',
  height: 400,
  render: async function(container, config) {
    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-secondary);height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:8px">
        <div style="color:var(--text-primary);font-weight:600;font-size:14px">api.db Integration Tests</div>
        <div id="log" style="flex:1;display:flex;flex-direction:column;gap:3px"></div>
        <div id="summary" style="font-size:12px;color:var(--text-muted);font-family:monospace"></div>
        <button id="run" style="padding:8px 16px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;align-self:flex-start">
          ▶ Run Tests
        </button>
      </div>`

    const logEl     = container.querySelector('#log')
    const summaryEl = container.querySelector('#summary')
    const btn       = container.querySelector('#run')

    const results = { pass: 0, fail: 0 }

    const log = (msg, ok = true) => {
      ok ? results.pass++ : results.fail++
      const el = document.createElement('div')
      el.style.cssText = `
        padding:4px 10px;border-radius:4px;font-size:12px;font-family:monospace;
        background:${ok ? 'rgba(74,222,128,0.1)' : 'rgba(255,107,107,0.1)'};
        color:${ok ? 'var(--accent-green)' : 'var(--accent-red)'};
        border-left:3px solid ${ok ? 'var(--accent-green)' : 'var(--accent-red)'}`
      el.textContent = (ok ? '✓  ' : '✗  ') + msg
      logEl.appendChild(el)
      el.scrollIntoView({ block: 'nearest' })
    }

    btn.onclick = async () => {
      logEl.innerHTML = ''
      summaryEl.textContent = ''
      results.pass = 0
      results.fail = 0
      btn.disabled = true
      btn.textContent = '⏳ Running…'

      try {
        // 0. Availability check
        try {
          await api.db.query({})
          log('api.db available — table provisioned')
        } catch (e) {
          log(`api.db not available: ${e.message}`, false)
          summaryEl.textContent = 'Cannot continue — api.db is not provisioned.'
          btn.disabled = false
          btn.textContent = '▶ Run Tests'
          return
        }

        // 1. Insert
        const row = await api.db.insert({ label: 'test-row', value: 42 })
        row?.id
          ? log(`insert → id: ${row.id.slice(0, 8)}…`)
          : log('insert: no id returned', false)

        // 2. Query all
        const all = await api.db.query({})
        all.length >= 1
          ? log(`query {} → ${all.length} row(s)`)
          : log('query {}: returned empty', false)

        // 3. Query with filter
        const filtered = await api.db.query({ label: 'test-row' })
        filtered.length >= 1
          ? log(`query {label:"test-row"} → ${filtered.length} row(s)`)
          : log('query {label:"test-row"}: no results', false)

        // 4. Update
        await api.db.update({ label: 'test-row' }, { value: 99 })
        const updated = await api.db.query({ label: 'test-row' })
        updated[0]?.value === 99
          ? log('update {value:99} → confirmed')
          : log(`update: expected 99, got ${updated[0]?.value}`, false)

        // 5. Delete
        await api.db.delete({ label: 'test-row' })
        const afterDelete = await api.db.query({ label: 'test-row' })
        afterDelete.length === 0
          ? log('delete → 0 rows remain')
          : log(`delete: ${afterDelete.length} row(s) still present`, false)

      } catch (e) {
        log(`unexpected error: ${e.message}`, false)
      }

      const total = results.pass + results.fail
      summaryEl.textContent = `${results.pass}/${total} passed  •  ${results.fail} failed`
      summaryEl.style.color = results.fail === 0 ? 'var(--accent-green)' : 'var(--accent-red)'
      btn.disabled = false
      btn.textContent = '▶ Run Again'
    }
  }
})