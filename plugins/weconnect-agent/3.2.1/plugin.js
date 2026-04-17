// @bump: patch
api.registerService({
  type: 'weconnect-diag',
  defaultConfig: { email: '' },
  create() {
    const CLIENT = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const SESSION = 'weconnect-diag:probe2'
    const log = (...a) => console.log('[wc-diag]', ...a)

    async function probe() {
      log('=== START v2 ===')
      try {
        const verifier = 'a'.repeat(64)
        const bytes = new TextEncoder().encode(verifier)
        const hash = await crypto.subtle.digest('SHA-256', bytes)
        const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

        const url = 'https://identity.vwgroup.io/oidc/v1/authorize?' + new URLSearchParams({
          client_id: CLIENT,
          response_type: 'code',
          redirect_uri: 'weconnect://authenticated',
          scope: 'openid profile address phone email mbb offline_access',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'diag2'
        })

        const r = await api.fetch(url, { session: SESSION })
        const html = await r.text()
        log('status', r.status, 'len', html.length, 'final url', r.url)

        // 1. Look for templateModel JSON blob (modern VW SPA login)
        const tmplMatch = html.match(/templateModel\s*[:=]\s*(\{[\s\S]*?\})\s*[,;]/)
        if (tmplMatch) {
          log('FOUND templateModel raw match, length:', tmplMatch[1].length)
          try {
            const json = JSON.parse(tmplMatch[1])
            log('templateModel keys:', Object.keys(json))
            log('templateModel content:', JSON.stringify(json).slice(0, 2000))
          } catch (e) {
            log('templateModel parse FAIL:', e.message)
            log('templateModel raw preview:', tmplMatch[1].slice(0, 800))
          }
        } else {
          log('NO templateModel found')
        }

        // 2. Look for window.__INITIAL_STATE__ / window.xyz = { ... }
        const windowAssign = html.match(/window\.(\w+)\s*=\s*(\{[\s\S]{0,3000}?\});/g)
        log('window.X assignments found:', windowAssign ? windowAssign.length : 0)
        if (windowAssign) {
          windowAssign.slice(0, 3).forEach((w, i) => log(`  [${i}]`, w.slice(0, 300)))
        }

        // 3. Look for any hmac/csrf/relayState anywhere
        const hmacMatches = html.match(/hmac[^,}\n]{0,200}/gi) || []
        const csrfMatches = html.match(/csrf[^,}\n]{0,200}/gi) || []
        const relayMatches = html.match(/relayState[^,}\n]{0,200}/gi) || []
        log('hmac hits:', hmacMatches.length, 'first:', hmacMatches[0]?.slice(0, 150))
        log('csrf hits:', csrfMatches.length, 'first:', csrfMatches[0]?.slice(0, 150))
        log('relayState hits:', relayMatches.length, 'first:', relayMatches[0]?.slice(0, 150))

        // 4. Count forms and inputs
        const forms = html.match(/<form[^>]*>/gi) || []
        const inputs = html.match(/<input[^>]*>/gi) || []
        log('forms:', forms.length, 'inputs:', inputs.length)
        forms.forEach((f, i) => log(`  form[${i}]`, f))
        inputs.slice(0, 15).forEach((inp, i) => log(`  input[${i}]`, inp))

        // 5. Count and preview inline scripts
        const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []
        log('script tags:', scripts.length)
        scripts.forEach((s, i) => {
          const body = s.replace(/<\/?script[^>]*>/gi, '').trim()
          if (body.length > 0 && body.length < 50000) {
            log(`  script[${i}] len=${body.length} preview:`, body.slice(0, 400))
          } else if (body.length >= 50000) {
            log(`  script[${i}] len=${body.length} (too big, skipped)`)
          }
        })

        // 6. Full body dump in chunks so we can see everything meaningful
        log('--- BODY DUMP (stripped of big scripts) ---')
        const stripped = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<script>…</script>')
        for (let i = 0; i < stripped.length; i += 2000) {
          log(`body[${i}..${i + 2000}]:`, stripped.slice(i, i + 2000))
        }

      } catch (e) {
        log('FAIL', e.message, e.stack)
      }
      log('=== END v2 ===')
    }

    setTimeout(probe, 500)
    return { probe }
  }
})