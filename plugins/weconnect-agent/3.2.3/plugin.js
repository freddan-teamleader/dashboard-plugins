// @bump: patch
api.registerService({
  type: 'weconnect-diag',
  defaultConfig: { email: '', password: '' },
  create() {
    const CLIENT = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const SESSION = 'weconnect-diag:probe4'
    const log = (...a) => console.log('[wc-diag v4]', ...a)

    async function probe() {
      log('=== START v4 ===')
      try {
        const cfg = api.config || {}

        // --- Step 1: PKCE ---
        const verifier = 'a'.repeat(64)
        const bytes = new TextEncoder().encode(verifier)
        const hash = await crypto.subtle.digest('SHA-256', bytes)
        const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

        // --- Step 2: GET authorize → cookie jar walks redirects → ULP login page ---
        const authUrl = 'https://identity.vwgroup.io/oidc/v1/authorize?' + new URLSearchParams({
          client_id: CLIENT,
          response_type: 'code',
          redirect_uri: 'weconnect://authenticated',
          scope: 'openid profile address phone email mbb offline_access',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'diag4'
        })

        log('GET', authUrl)
        const r1 = await api.fetch(authUrl, { session: SESSION })
        log('GET status:', r1.status, 'redirected:', r1.redirected)

        const html1 = await r1.text()
        log('body len:', html1.length)

        // Extract the state value from the hidden input — this is Auth0's opaque session state
        const stateMatch = html1.match(/name="state"\s+value="([^"]+)"/)
          || html1.match(/value="([^"]+)"\s+name="state"/)
        const ulpState = stateMatch?.[1]
        log('ulpState len:', ulpState?.length, 'preview:', ulpState?.slice(0, 60))

        if (!ulpState) { log('NO ulpState — abort'); log('=== END v4 ==='); return }

        // --- Step 3: The key insight ---
        // Auth0 ULP's form has no action= so it POSTs to the current page URL.
        // The current page after redirects is /u/login/identifier?state=<ulpState>
        // BUT the proxy returns its own URL as r1.url, hiding the real upstream URL.
        // We reconstruct the real upstream URL from the state value directly.
        // Auth0 ULP always uses these two endpoints:
        //   POST /u/login/identifier?state=<state>   ← submit username
        //   POST /u/login/password?state=<state>     ← submit password
        // Try both patterns and see which one responds correctly.

        const base = 'https://identity.vwgroup.io'

        // Pattern A: Auth0 combined login (username+password in one POST)
        const urlA = `${base}/u/login?state=${encodeURIComponent(ulpState)}`
        // Pattern B: Auth0 identifier-first (username then password)
        const urlB = `${base}/u/login/identifier?state=${encodeURIComponent(ulpState)}`
        // Pattern C: POST directly to the authorize endpoint with the ulpState
        const urlC = `${base}/u/login/password?state=${encodeURIComponent(ulpState)}`

        const postBody = new URLSearchParams({
          state: ulpState,
          username: cfg.email || 'test@example.com',
          password: cfg.password || 'dummypassword',
          action: 'default'
        }).toString()

        log('Testing POST patterns...')
        for (const [label, url] of [['A /u/login', urlA], ['B /u/login/identifier', urlB], ['C /u/login/password', urlC]]) {
          try {
            const r = await api.fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: postBody,
              session: SESSION,
              redirect: 'manual'
            })
            const body = await r.text()
            const headers = {}
            r.headers.forEach((v, k) => { headers[k] = v })
            log(`${label} → status:${r.status} location:${headers.location || '(none)'} bodyLen:${body.length}`)
            log(`${label} → body preview:`, body.slice(0, 300))
            // Look for code= in body or location
            const codeInLoc = headers.location?.match(/[?&]code=([^&]+)/)?.[1]
            const codeInBody = body.match(/[?&]code=([^&"'<>\s]+)/)?.[1]
            if (codeInLoc) log(`*** CODE FOUND in location: ${codeInLoc.slice(0, 40)}`)
            if (codeInBody) log(`*** CODE FOUND in body: ${codeInBody.slice(0, 40)}`)
          } catch (e) {
            log(`${label} → THREW: ${e.message}`)
          }
        }

        // --- Step 4: Also try a GET on those URLs to see what they serve ---
        log('--- Testing GET on ULP paths ---')
        for (const [label, url] of [['A /u/login', urlA], ['B /u/login/identifier', urlB]]) {
          try {
            const r = await api.fetch(url, { session: SESSION })
            const body = await r.text()
            log(`GET ${label} → status:${r.status} bodyLen:${body.length} preview:`, body.slice(0, 200))
          } catch (e) {
            log(`GET ${label} → THREW: ${e.message}`)
          }
        }

      } catch (e) {
        log('FATAL:', e.message, e.stack?.slice(0, 300))
      }
      log('=== END v4 ===')
    }

    setTimeout(probe, 500)
    return { probe }
  }
})