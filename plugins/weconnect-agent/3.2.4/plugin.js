// @bump: patch
api.registerService({
  type: 'weconnect-diag',
  defaultConfig: { email: '', password: '' },
  create() {
    const CLIENT  = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const SESSION = 'weconnect-diag:probe5'
    const IDENTITY = 'https://identity.vwgroup.io'
    const BASE_API = 'https://mobileapi.apps.emea.vwapps.io'
    const log = (...a) => console.log('[wc-diag v5]', ...a)

    async function probe() {
      log('=== START v5 ===')
      try {
        const cfg = api.config || {}
        if (!cfg.email || !cfg.password) {
          log('ERROR: set email and password in Settings first')
          log('=== END v5 ===')
          return
        }

        // --- PKCE ---
        const verifier = btoa(String.fromCharCode(
          ...crypto.getRandomValues(new Uint8Array(32))
        )).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
        const digest = await crypto.subtle.digest(
          'SHA-256', new TextEncoder().encode(verifier)
        )
        const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
          .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')

        // --- Step 1: GET authorize → Auth0 ULP page ---
        const authUrl = `${IDENTITY}/oidc/v1/authorize?` + new URLSearchParams({
          client_id: CLIENT,
          response_type: 'code',
          redirect_uri: 'weconnect://authenticated',
          scope: 'openid profile address phone email mbb offline_access',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'diag5'
        })
        log('Step 1: GET authorize')
        const r1 = await api.fetch(authUrl, { session: SESSION })
        const html1 = await r1.text()
        log(`Step 1 status:${r1.status} bodyLen:${html1.length}`)

        // Extract Auth0 ulpState from hidden input
        const ulpState = html1.match(/name="state"\s+value="([^"]+)"/)?.[1]
                      || html1.match(/value="([^"]+)"\s+name="state"/)?.[1]
        log(`Step 1 ulpState: len=${ulpState?.length} preview=${ulpState?.slice(0,40)}`)
        if (!ulpState) { log('FATAL: no ulpState'); log('=== END v5 ==='); return }

        // --- Step 2: POST /u/login with real credentials ---
        // This is Auth0's combined login endpoint (username+password in one shot)
        const loginUrl = `${IDENTITY}/u/login?state=${encodeURIComponent(ulpState)}`
        const loginBody = new URLSearchParams({
          state:    ulpState,
          username: cfg.email,
          password: cfg.password,
          action:   'default'
        }).toString()

        log(`Step 2: POST ${loginUrl}`)
        const r2 = await api.fetch(loginUrl, {
          method:  'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body:    loginBody,
          session: SESSION,
          redirect: 'manual'
        })
        const body2 = await r2.text()
        const hdrs2 = {}
        r2.headers.forEach((v,k) => { hdrs2[k] = v })
        log(`Step 2 status:${r2.status} location:${hdrs2.location || '(none)'} bodyLen:${body2.length}`)
        log(`Step 2 body preview:`, body2.slice(0, 400))

        // Check for code in location
        const codeInLoc2 = hdrs2.location?.match(/[?&]code=([^&]+)/)?.[1]
        if (codeInLoc2) {
          log(`*** CODE in Step 2 location: ${codeInLoc2.slice(0,40)}`)
          await exchangeCode(codeInLoc2, verifier)
          log('=== END v5 ===')
          return
        }

        // If 302 to another URL, follow it manually
        if (r2.status === 302 && hdrs2.location) {
          log(`Step 2 redirecting to: ${hdrs2.location}`)
          await followRedirects(hdrs2.location, verifier, SESSION, 0)
          log('=== END v5 ===')
          return
        }

        // If we got HTML back (error or next step), log what fields it has
        const fields2 = [...body2.matchAll(/name="([^"]+)"/g)].map(m=>m[1])
        log(`Step 2 form fields:`, fields2)
        const errorMsg = body2.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</)?.[1]
                      || body2.match(/aria-live="polite"[^>]*>([^<]+)</)?.[1]
        if (errorMsg) log(`Step 2 error message: "${errorMsg.trim()}"`)

        // --- Step 2b: Try identifier-first if combined failed ---
        if (r2.status !== 302) {
          log('Step 2 did not redirect — trying identifier-first flow...')

          const idUrl  = `${IDENTITY}/u/login/identifier?state=${encodeURIComponent(ulpState)}`
          const idBody = new URLSearchParams({
            state: ulpState, username: cfg.email, action: 'default'
          }).toString()

          log(`Step 2b: POST identifier ${idUrl}`)
          const r2b = await api.fetch(idUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: idBody,
            session: SESSION,
            redirect: 'manual'
          })
          const body2b = await r2b.text()
          const hdrs2b = {}
          r2b.headers.forEach((v,k) => { hdrs2b[k] = v })
          log(`Step 2b status:${r2b.status} location:${hdrs2b.location||'(none)'} bodyLen:${body2b.length}`)
          log(`Step 2b body preview:`, body2b.slice(0,400))

          // Extract new ulpState for password step
          const ulpState2 = body2b.match(/name="state"\s+value="([^"]+)"/)?.[1] || ulpState
          log(`Step 2b ulpState for password: len=${ulpState2?.length}`)

          // Step 2c: POST password
          const pwUrl  = `${IDENTITY}/u/login/password?state=${encodeURIComponent(ulpState2)}`
          const pwBody = new URLSearchParams({
            state: ulpState2, username: cfg.email, password: cfg.password, action: 'default'
          }).toString()
          log(`Step 2c: POST password ${pwUrl}`)
          const r2c = await api.fetch(pwUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: pwBody,
            session: SESSION,
            redirect: 'manual'
          })
          const body2c = await r2c.text()
          const hdrs2c = {}
          r2c.headers.forEach((v,k) => { hdrs2c[k] = v })
          log(`Step 2c status:${r2c.status} location:${hdrs2c.location||'(none)'} bodyLen:${body2c.length}`)
          log(`Step 2c body preview:`, body2c.slice(0,400))

          const codeInLoc2c = hdrs2c.location?.match(/[?&]code=([^&]+)/)?.[1]
          if (codeInLoc2c) {
            log(`*** CODE in Step 2c location: ${codeInLoc2c.slice(0,40)}`)
            await exchangeCode(codeInLoc2c, verifier)
          }
          if (r2c.status === 302 && hdrs2c.location) {
            await followRedirects(hdrs2c.location, verifier, SESSION, 0)
          }
        }

      } catch(e) {
        log('FATAL:', e.message, e.stack?.slice(0,200))
      }
      log('=== END v5 ===')
    }

    async function followRedirects(location, verifier, session, depth) {
      const log = (...a) => console.log('[wc-diag v5]', ...a)
      if (depth > 8) { log('Too many redirects'); return }

      // Check for code in weconnect:// URL
      if (location.startsWith('weconnect://')) {
        const code = new URL(location.replace('weconnect://', 'https://dummy/')).searchParams.get('code')
        log(`*** CODE from weconnect redirect (depth ${depth}): ${code?.slice(0,40)}`)
        if (code) await exchangeCode(code, verifier)
        return
      }

      // Ensure absolute URL
      const url = location.startsWith('http') ? location : `https://identity.vwgroup.io${location}`
      log(`followRedirects depth=${depth} GET ${url}`)
      const r = await api.fetch(url, { session, redirect: 'manual' })
      const body = await r.text()
      const hdrs = {}
      r.headers.forEach((v,k) => { hdrs[k] = v })
      log(`followRedirects depth=${depth} status:${r.status} location:${hdrs.location||'(none)'} bodyLen:${body.length}`)

      const codeInLoc = hdrs.location?.match(/[?&]code=([^&]+)/)?.[1]
      if (codeInLoc) {
        log(`*** CODE found at depth ${depth}: ${codeInLoc.slice(0,40)}`)
        await exchangeCode(codeInLoc, verifier)
        return
      }
      if (hdrs.location) await followRedirects(hdrs.location, verifier, session, depth + 1)
    }

    async function exchangeCode(code, verifier) {
      const log = (...a) => console.log('[wc-diag v5]', ...a)
      log(`Exchanging code for tokens...`)
      const r = await api.fetch(`https://identity.vwgroup.io/oidc/v1/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  'weconnect://authenticated',
          client_id:     'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com',
          code_verifier: verifier
        }).toString()
      })
      const data = await r.json()
      log(`Token exchange status:${r.status}`)
      log(`Token keys:`, Object.keys(data))
      if (data.access_token) {
        log(`access_token preview: ${data.access_token.slice(0,40)}`)
        log(`token_type: ${data.token_type} expires_in: ${data.expires_in}`)
        // Try vehicle API
        await tryVehicleAPIs(data.access_token)
      } else {
        log(`Token error:`, JSON.stringify(data))
      }
    }

    async function tryVehicleAPIs(token) {
      const log = (...a) => console.log('[wc-diag v5]', ...a)
      const headers = { Authorization: `Bearer ${token}` }
      const hosts = [
        'https://mobileapi.apps.emea.vwapps.io',
        'https://msg.volkswagen.de/fs-car',
        'https://api.connect.volkswagen-we.com/v1',
      ]
      for (const base of hosts) {
        try {
          const r = await api.fetch(`${base}/vehicles`, { headers })
          const body = await r.text()
          log(`vehicles @ ${base} → status:${r.status} body:${body.slice(0,200)}`)
        } catch(e) {
          log(`vehicles @ ${base} → THREW: ${e.message}`)
        }
      }
    }

    setTimeout(probe, 500)
    return { probe }
  }
})