// @bump: patch
api.registerWidget({
  type: 'storage-api-test',
  title: '🧪 Storage API Test',
  description: 'Tests api.storage — key/value persistence',
  height: 380,
  render: async function(container, config) {
    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-secondary);height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:0">
        <div style="color:var(--text-primary);font-weight:600;margin-bottom:12px;font-size:14px">api.storage tests</div>
        <div id="log" style="flex:1;overflow:auto"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:12px">
          <button id="run" style="padding:8px 16px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500">▶ Run tests</button>
          <span id="summary" style="font-size:12px;color:var(--text-muted);font-family:monospace"></span>
        </div>
      </div>`

    const logEl   = container.querySelector('#log')
    const btn     = container.querySelector('#run')
    const summary = container.querySelector('#summary')

    const log = (msg, ok = true) => {
      const el = document.createElement('div')
      el.style.cssText = `padding:4px 8px;margin:2px 0;border-radius:4px;font-size:12px;font-family:monospace;` +
        (ok ? 'background:rgba(74,222,128,0.12);color:var(--accent-green)' : 'background:rgba(255,107,107,0.12);color:var(--accent-red)')
      el.textContent = (ok ? '✓ ' : '✗ ') + msg
      logEl.appendChild(el)
      logEl.scrollTop = logEl.scrollHeight
    }

    btn.onclick = async () => {
      logEl.innerHTML = ''
      summary.textContent = ''
      btn.disabled = true
      btn.textContent = '⏳ Running…'
      let passed = 0, failed = 0
      const check = (cond, msgOk, msgFail) => { cond ? (log(msgOk), passed++) : (log(msgFail, false), failed++) }

      try {
        // 1. set + get string
        await api.storage.set('test-string', 'hello')
        const s = await api.storage.get('test-string')
        check(s === 'hello', 'set/get string → "hello"', `set/get string → got ${JSON.stringify(s)}`)

        // 2. set + get object
        await api.storage.set('test-object', { x: 1, arr: [1, 2, 3] })
        const o = await api.storage.get('test-object')
        check(JSON.stringify(o) === JSON.stringify({ x: 1, arr: [1, 2, 3] }),
          'set/get object → {x:1, arr:[1,2,3]}', `set/get object → got ${JSON.stringify(o)}`)

        // 3. overwrite
        await api.storage.set('test-string', 'world')
        const s2 = await api.storage.get('test-string')
        check(s2 === 'world', 'overwrite → "world"', `overwrite → got ${JSON.stringify(s2)}`)

        // 4. get missing key → null
        const missing = await api.storage.get('__nonexistent__')
        check(missing === null, 'get missing key → null', `get missing key → got ${JSON.stringify(missing)}`)

        // 5. list includes written keys
        const entries = await api.storage.list()
        const keys = entries.map(e => e.key).sort()
        check(keys.includes('test-string') && keys.includes('test-object'),
          `list → ${keys.length} key(s): ${keys.join(', ')}`,
          `list → unexpected keys ${JSON.stringify(keys)}`)

        // 6. delete
        await api.storage.delete('test-string')
        const afterDelete = await api.storage.get('test-string')
        check(afterDelete === null, 'delete → key removed', 'delete → key still present')

        // 7. rate limit — burst 62 writes, expect an error
        let rateLimitHit = false
        try {
          for (let i = 0; i < 62; i++) await api.storage.set('rl-test', i)
        } catch (e) {
          rateLimitHit = e.message?.toLowerCase().includes('rate limit')
        }
        check(rateLimitHit, 'rate limit → triggered after 60 writes', 'rate limit → NOT triggered (check implementation)')

      } catch (e) {
        log(`unexpected error: ${e.message}`, false)
        failed++
      } finally {
        // Cleanup regardless of failures
        await Promise.allSettled([
          api.storage.delete('test-string'),
          api.storage.delete('test-object'),
          api.storage.delete('rl-test'),
        ])
        log('cleanup → done')
      }

      summary.textContent = `${passed} passed · ${failed} failed`
      summary.style.color = failed ? 'var(--accent-red)' : 'var(--accent-green)'
      btn.disabled = false
      btn.textContent = '▶ Run again'
    }
  }
})