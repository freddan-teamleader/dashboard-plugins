// @bump: patch
api.registerService({
  type: 'weconnect-diag',
  defaultConfig: { email: '', password: '' },
  create() {
    const CLIENT = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const SESSION = 'weconnect-diag:probe3'
    const log = (...a) => console.log('[wc-diag v3]', ...a)

    async function probe() {
      log('=== START v3 ===')
      try {
        const cfg = api.config || {}
        if (!cfg.email || !cfg.password) {
          log('NOTE: no email/password in config — POST will likely 400, but we still learn endpoint structure')
        }

        // --- Step 1: GET authorize, let cookie jar follow redirects ---
        const verifier = 'a'.repeat(64)
        const bytes = new TextEncoder().encode(verifier)
        const hash = await crypto.subtle.digest('SHA-256', bytes)
        const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

        const authUrl = 'https://identity.vwgroup.io/oidc/v1/authorize?' + new URLSearchParams({
          client_id: CLIENT,
          response_type: 'code',
          redirect_uri: 'weconnect://authenticated',
          scope: 'openid profile address phone email mbb offline_access',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'diag3'
        })

        log('GET', authUrl)
        const r1 = await api.fetch(authUrl, { session: SESSION })
        log('GET status:', r1.status)
        log('GET response url (where redirects landed):', r1.url)
        log('GET response redirected flag:', r1.redirected)
        const html1 = await r1.text()
        log('GET body length:', html1.length)

        // Try to extract state from the HTML (we know it's there)
        const stateMatch = html1.match(/name="state"\s+value="([^"]+)"/)
        const state = stateMatch?.[1]
        log('extracted state len:', state?.length, 'preview:', state?.slice(0, 40))

        // Also look for the form action attribute, if any
        const formActionMatch = html1.match(/<form[^>]*action="([^"]+)"/i)
        log('form action attr:', formActionMatch?.[1] || '(none — posts to current URL)')

        // Look for any URL hints in the HTML that tell us the ULP path
        const ulpPathMatches = html1.match(/\/u\/login\/[a-z-]+/gi) || []
        log('ULP path hints in HTML:', [...new Set(ulpPathMatches)])

        // Also grab any <script> references to endpoints
        const endpointHints = html1.match(/["'](\/u\/[^"'?]+)["']/g) || []
        log('endpoint hints (first 10):', endpointHints.slice(0, 10))

        if (!state) {
          log('NO state found — aborting')
          log('=== END v3 ===')
          return
        }

        // --- Step 2: POST credentials to the same URL (Auth0 ULP convention) ---
        // The form has no action attribute, so it POSTs to the current URL (r1.url's target).
        // But r1.url is our proxy URL. We need to reconstruct the real upstream URL.
        // The proxy URL format is: /__proxy__?url=<encoded>
        const proxyUrlObj = new URL(r1.url, window.location.origin)
        const upstreamUrl = proxyUrlObj.searchParams.get('url')
        log('upstream URL after redirects:', upstreamUrl)

        const postTarget = upstreamUrl || authUrl
        log('POST target:', postTarget)

        const postBody = new URLSearchParams({
          state,
          username: cfg.email || 'test@example.com',
          password: cfg.password || 'dummypassword',
          action: 'default'
        })
        log('POST body:', postBody.toString().replace(/password=[^&]+/, 'password=***'))

        const r2 = await api.fetch(postTarget, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: postBody.toString(),
          session: SESSION,
          redirect: 'manual'
        })
        log('POST 1 status:', r2.status)
        log('POST 1 response url:', r2.url)
        log('POST 1 redirected flag:', r2.redirected)

        // Log all response headers we can see
        const headerDump = {}
        r2.headers.forEach((v, k) => { headerDump[k] = v })
        log('POST 1 response headers:', headerDump)
        log('POST 1 location header:', r2.headers.get('location'))

        const body2 = await r2.text()
        log('POST 1 body length:', body2.length)
        log('POST 1 body first 1500 chars:', body2.slice(0, 1500))

        // Look for error messages in body
        const errorMatches = body2.match(/error[^"<]{0,300}/gi) || []
        log('error hits in body:', errorMatches.slice(0, 5))

        // Look for redirect hints (JS-based redirects, meta refresh, etc.)
        const metaRefresh = body2.match(/<meta[^>]*refresh[^>]*>/i)
        log('meta refresh:', metaRefresh?.[0])

        const jsRedirect = body2.match(/(?:window\.location|location\.href)\s*=\s*['"]([^'"]+)['"]/i)
        log('JS redirect:', jsRedirect?.[1])

        // Look for weconnect:// anywhere
        const wcMatch = body2.match(/weconnect:\/\/[^\s"'<>]+/)
        log('weconnect:// URL in body:', wcMatch?.[0])

        // Look for code= anywhere
        const codeMatch = body2.match(/[?&]code=([^&"'<>\s]+)/)
        log('code param in body:', codeMatch?.[1]?.slice(0, 40))

      } catch (e) {
        log('FAIL', e.message, e.stack)
      }
      log('=== END v3 ===')
    }

    setTimeout(probe, 500)
    return { probe }
  }
})