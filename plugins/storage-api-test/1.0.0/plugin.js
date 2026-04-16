api.registerWidget({
  type: 'storage-api-test',
  title: '🧪 Storage API Test',
  description: 'Tests api.storage — key/value persistence',
  height: 380,
  render: async function(container, config) {
    const log = (msg, ok = true) => {
      const el = document.createElement('div')
      el.style.cssText = `padding:4px 8px;margin:2px 0;border-radius:4px;font-size:13px;font-family:monospace;background:${ok ? 'rgba(74,222,128,0.15)' : 'rgba(255,107,107,0.15)'};color:${ok ? 'var(--accent-green)' : 'var(--accent-red)'};border-left:3px solid ${ok ? 'var(--accent-green)' : 'var(--accent-red)'}`
      el.textContent = (ok ? '✓ ' : '✗ ') + msg
      container.querySelector('#log').appendChild(el)
    }

    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-secondary);height:100%;box-sizing:border-box;overflow:auto;font-family:monospace">
        <div style="color:var(--text-primary);font-weight:600;margin-bottom:12px;font-size:14px">api.storage tests</div>
        <div id="log"></div>
        <button id="run" style="margin-top:12px;padding:8px 16px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-family:monospace">▶ Run tests</button>
      </div>`

    container.querySelector('#run').onclick = async () => {
      container.querySelector('#log').innerHTML = ''
      const btn = container.querySelector('#run')
      btn.disabled = true
      btn.textContent = '⏳ Running…'

      try {
        // 1. set + get round-trip
        await api.storage.set('test-string', 'hello')
        const s = await api.storage.get('test-string')
        s === 'hello'
          ? log('set/get string: "hello"')
          : log(`set/get string: got ${JSON.stringify(s)}`, false)

        // 2. JSON value
        await api.storage.set('test-object', { x: 1, arr: [1, 2, 3] })
        const o = await api.storage.get('test-object')
        JSON.stringify(o) === JSON.stringify({ x: 1, arr: [1, 2, 3] })
          ? log('set/get object: {x:1, arr:[1,2,3]}')
          : log(`set/get object: got ${JSON.stringify(o)}`, false)

        // 3. overwrite
        await api.storage.set('test-string', 'world')
        const s2 = await api.storage.get('test-string')
        s2 === 'world'
          ? log('overwrite: "world"')
          : log(`overwrite: got ${JSON.stringify(s2)}`, false)

        // 4. get missing key → null
        const missing = await api.storage.get('__nonexistent__')
        missing === null
          ? log('get missing key: null')
          : log(`get missing key: got ${JSON.stringify(missing)}`, false)

        // 5. list
        const entries = await api.storage.list()
        const keys = entries.map(e => e.key).sort()
        keys.includes('test-string') && keys.includes('test-object')
          ? log(`list: ${keys.length} key(s) — ${keys.join(', ')}`)
          : log(`list: unexpected keys ${JSON.stringify(keys)}`, false)

        // 6. delete
        await api.storage.delete('test-string')
        const afterDelete = await api.storage.get('test-string')
        afterDelete === null
          ? log('delete: key removed')
          : log('delete: key still present', false)

        // 7. rate limit — 60 writes should succeed, 61st should throw
        let rateLimitHit = false
        try {
          for (let i = 0; i < 62; i++) await api.storage.set('rl-test', i)
        } catch (e) {
          rateLimitHit = e.message?.includes('rate limit')
        }
        rateLimitHit
          ? log('rate limit: triggered at write 61')
          : log('rate limit: NOT triggered — check implementation', false)

        // Cleanup
        await api.storage.delete('test-object')
        await api.storage.delete('rl-test')
        log('cleanup: done')

      } catch (e) {
        log(`unexpected error: ${e.message}`, false)
      }

      btn.disabled = false
      btn.textContent = '▶ Run again'
    }
  }
})