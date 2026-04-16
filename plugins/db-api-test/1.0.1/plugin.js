// @bump: patch
api.registerWidget({
  type: 'db-api-test',
  title: '🧪 DB API Test',
  description: 'Tests api.db — structured table storage',
  height: 400,
  render: async function(container, config) {
    const log = (msg, ok = true) => {
      const el = document.createElement('div')
      el.style.cssText = `
        padding: 4px 8px;
        margin: 2px 0;
        border-radius: 4px;
        font-size: 13px;
        font-family: monospace;
        background: ${ok ? 'rgba(74,222,128,0.12)' : 'rgba(255,107,107,0.12)'};
        color: ${ok ? 'var(--accent-green)' : 'var(--accent-red)'};
        border: 1px solid ${ok ? 'rgba(74,222,128,0.2)' : 'rgba(255,107,107,0.2)'};
      `
      el.textContent = (ok ? '✓ ' : '✗ ') + msg
      container.querySelector('#log').appendChild(el)
    }

    container.innerHTML = `
      <div style="
        padding: 16px;
        background: var(--bg-secondary);
        height: 100%;
        box-sizing: border-box;
        overflow: auto;
      ">
        <div style="color: var(--text-primary); font-weight: 600; margin-bottom: 12px; font-size: 14px;">
          api.db tests
        </div>
        <div id="log"></div>
        <button id="run" style="
          margin-top: 12px;
          padding: 8px 16px;
          background: var(--accent-blue);
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          opacity: 1;
          transition: opacity 0.15s;
        ">Run tests</button>
      </div>`

    const btn = container.querySelector('#run')

    btn.onmouseenter = () => { btn.style.opacity = '0.85' }
    btn.onmouseleave = () => { btn.style.opacity = '1' }

    btn.onclick = async () => {
      container.querySelector('#log').innerHTML = ''
      btn.disabled = true
      btn.style.opacity = '0.5'
      btn.textContent = 'Running…'

      try {
        // 0. check availability
        try {
          await api.db.query({})
          log('api.db available: provisioned ✓')
        } catch(e) {
          if (e.message.includes('not available')) {
            log('api.db not provisioned — Edge Function may have failed. Check console.', false)
            btn.disabled = false
            btn.style.opacity = '1'
            btn.textContent = 'Run tests'
            return
          }
          throw e
        }

        // 1. insert
        const row = await api.db.insert({ label: 'test-row', value: 42 })
        row?.id
          ? log(`insert: got id ${row.id.slice(0, 8)}…`)
          : log('insert: no id returned', false)

        // 2. query all
        const all = await api.db.query({})
        all.length >= 1
          ? log(`query all: ${all.length} row(s)`)
          : log('query all: empty', false)

        // 3. query with filter
        const filtered = await api.db.query({ label: 'test-row' })
        filtered.length >= 1
          ? log(`query filter {label:"test-row"}: ${filtered.length} row(s)`)
          : log('query filter: no results', false)

        // 4. update
        await api.db.update({ label: 'test-row' }, { value: 99 })
        const updated = await api.db.query({ label: 'test-row' })
        updated[0]?.value === 99
          ? log('update: value → 99')
          : log(`update: value is ${updated[0]?.value}`, false)

        // 5. delete
        await api.db.delete({ label: 'test-row' })
        const afterDelete = await api.db.query({ label: 'test-row' })
        afterDelete.length === 0
          ? log('delete: rows removed')
          : log(`delete: ${afterDelete.length} rows remain`, false)

      } catch(e) {
        log(`unexpected error: ${e.message}`, false)
      }

      btn.disabled = false
      btn.style.opacity = '1'
      btn.textContent = 'Run again'
    }
  }
})