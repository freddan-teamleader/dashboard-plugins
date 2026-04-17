// @bump: minor
api.registerService({
  type: 'weconnect-diag',
  defaultConfig: { email: '' },
  create() {
    const CLIENT = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const SESSION = 'weconnect-diag:probe'
    const log = (...a) => console.log('[wc-diag]', ...a)

    async function probe() {
      log('=== START ===')
      log('api.fetch exists?', typeof api.fetch)
      log('session param supported? (will know by behaviour)')

      // Probe 1: plain GET to identity root
      try {
        const r = await api.fetch('https://identity.vwgroup.io/', { session: SESSION })
        log('P1 identity.vwgroup.io/', r.status, 'redirected:', r.redirected, 'url:', r.url)
      } catch (e) { log('P1 FAIL', e.message) }

      // Probe 2: authorize with PKCE
      try {
        const verifier = 'a'.repeat(64)
        const bytes = new TextEncoder().encode(verifier)
        const hash = await crypto.subtle.digest('SHA-256', bytes)
        const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
          .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
        const url = 'https://identity.vwgroup.io/oidc/v1/authorize?' + new URLSearchParams({
          client_id: CLIENT, response_type: 'code',
          redirect_uri: 'weconnect://authenticated',
          scope: 'openid profile address phone email mbb offline_access',
          code_challenge: challenge, code_challenge_method: 'S256',
          state: 'diag'
        })
        const r = await api.fetch(url, { session: SESSION })
        const body = await r.text()
        log('P2 authorize', r.status, 'url:', r.url, 'len:', body.length)
        log('P2 first 500 chars:', body.slice(0, 500))
        log('P2 has _csrf?', /_csrf/.test(body), 'has hmac?', /name="hmac"/.test(body), 'has relayState?', /relayState/.test(body))
      } catch (e) { log('P2 FAIL', e.message, e.stack) }

      // Probe 3: mobile API host (is it reachable now?)
      try {
        const r = await api.fetch('https://mobileapi.apps.emea.vwapps.io/vehicles', { session: SESSION })
        log('P3 mobileapi', r.status, 'url:', r.url)
      } catch (e) { log('P3 FAIL', e.message) }

      // Probe 4: legacy gateway
      try {
        const r = await api.fetch('https://msg.volkswagen.de/fs-car/', { session: SESSION })
        log('P4 msg.volkswagen.de', r.status)
      } catch (e) { log('P4 FAIL', e.message) }

      log('=== END ===')
    }

    setTimeout(probe, 500)
    return { probe }
  }
})