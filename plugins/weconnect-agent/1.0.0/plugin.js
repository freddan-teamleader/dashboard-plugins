api.registerService({
  type: 'weconnect-agent',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  events: {
    'reading:new':   { description: 'New odometer/level reading stored', schema: { vin: 'string', odometer: 'number', level: 'number', levelType: 'string', timestamp: 'string' } },
    'status:change': { description: 'Agent status update',              schema: { status: 'string', message: 'string' } }
  },
  create() {
    const SESSION  = 'weconnect-agent:auth'
    const CLIENT   = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const REDIRECT = 'weconnect://authenticated'
    const IDENTITY = 'https://identity.vwgroup.io'
    const MSGVW    = 'https://msg.volkswagen.de/fs-car'

    const cfg = () => api.config || {}
    let tokens      = null   // { access_token, refresh_token, expires_at }
    let pollTimer   = null
    let lastReading = null
    let lastStatus  = { status: 'idle', message: 'Not started' }

    function emit(event, data) {
      api.emit(`weconnect-agent:${event}`, data)
      if (event === 'status:change') lastStatus = data
    }

    function setStatus(status, message) {
      console.log(`[weconnect-agent] ${status}: ${message}`)
      emit('status:change', { status, message })
    }

    // --- PKCE ---
    async function generatePKCE() {
      const arr      = crypto.getRandomValues(new Uint8Array(32))
      const verifier = btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
      const digest   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
      return { verifier, challenge }
    }

    // --- Auth ---
    async function login() {
      const { email, password } = cfg()
      if (!email || !password) throw new Error('Email and password not configured')

      setStatus('polling', 'Authenticating…')
      const { verifier, challenge } = await generatePKCE()
      const state = crypto.randomUUID()

      // Step 1: GET authorize → extract form fields (session captures cookies)
      const authUrl = `${IDENTITY}/oidc/v1/authorize?` + new URLSearchParams({
        client_id: CLIENT, response_type: 'code', redirect_uri: REDIRECT,
        scope: 'openid profile address phone email mbb offline_access',
        code_challenge: challenge, code_challenge_method: 'S256', state
      })
      const r1 = await api.fetch(authUrl, { session: SESSION })
      const html1 = await r1.text()
      console.log('[weconnect-agent] Step 1 status:', r1.status)

      const csrf       = html1.match(/name="_csrf"\s+value="([^"]+)"/)?.[1]
               || html1.match(/value="([^"]+)"\s+name="_csrf"/)?.[1]
      const relayState = html1.match(/name="relayState"\s+value="([^"]+)"/)?.[1]
               || html1.match(/value="([^"]+)"\s+name="relayState"/)?.[1]
      const hmac1      = html1.match(/name="hmac"\s+value="([^"]+)"/)?.[1]
               || html1.match(/value="([^"]+)"\s+name="hmac"/)?.[1]

      console.log('[weconnect-agent] Step 1 fields:', { csrf: !!csrf, relayState: !!relayState, hmac: !!hmac1 })
      if (!csrf || !relayState || !hmac1) throw new Error('Could not parse login form fields')

      // Step 2: POST email → get new hmac (session carries cookies)
      const r2 = await api.fetch(
        `${IDENTITY}/signin-service/v1/${CLIENT}/login/identifier`,
        { method: 'POST', session: SESSION,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf, relayState, email, hmac: hmac1 }).toString()
        }
      )
      const html2 = await r2.text()
      console.log('[weconnect-agent] Step 2 status:', r2.status)

      const hmac2 = html2.match(/name="hmac"\s+value="([^"]+)"/)?.[1]
             || html2.match(/value="([^"]+)"\s+name="hmac"/)?.[1]
      if (!hmac2) throw new Error('Could not parse password form — wrong email?')

      // Step 3: POST password → proxy walks redirects, code in final Location
      const r3 = await api.fetch(
        `${IDENTITY}/signin-service/v1/${CLIENT}/login/authenticate`,
        { method: 'POST', session: SESSION,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf, relayState, email, password, hmac: hmac2 }).toString()
        }
      )
      console.log('[weconnect-agent] Step 3 status:', r3.status, 'url:', r3.url)

      // Final URL is weconnect://authenticated?code=... — normalise to parse
      const finalUrl = r3.url || ''
      const codeUrl  = finalUrl.replace('weconnect://', 'https://weconnect-dummy.local/')
      const code     = new URL(codeUrl).searchParams.get('code')
      if (!code) throw new Error(`No auth code in redirect. Final URL: ${finalUrl}`)

      console.log('[weconnect-agent] Got auth code ✓')

      // Step 4: exchange code for tokens
      const r4 = await api.fetch(`${IDENTITY}/oidc/v1/token`, {
        method: 'POST', session: SESSION,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code,
          redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier
        }).toString()
      })
      const tok = await r4.json()
      console.log('[weconnect-agent] Token response keys:', Object.keys(tok))
      if (!tok.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tok)}`)

      tokens = {
        access_token:  tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at:    Date.now() + (tok.expires_in || 3600) * 1000
      }
      api.updateConfig({ _cachedTokens: tokens })
      console.log('[weconnect-agent] Authenticated ✓')
    }

    async function refreshTokens() {
      if (!tokens?.refresh_token) { tokens = null; return }
      try {
        const r = await api.fetch(`${IDENTITY}/oidc/v1/token`, {
          method: 'POST', session: SESSION,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: CLIENT
          }).toString()
        })
        const tok = await r.json()
        if (!tok.access_token) throw new Error('Refresh failed')
        tokens = { access_token: tok.access_token, refresh_token: tok.refresh_token || tokens.refresh_token, expires_at: Date.now() + (tok.expires_in || 3600) * 1000 }
        api.updateConfig({ _cachedTokens: tokens })
        console.log('[weconnect-agent] Token refreshed ✓')
      } catch (e) {
        console.warn('[weconnect-agent] Refresh failed, will re-login:', e.message)
        tokens = null
      }
    }

    async function vwGet(path) {
      if (!tokens || Date.now() > tokens.expires_at - 60_000) await refreshTokens()
      if (!tokens) await login()
      const res = await api.fetch(`${MSGVW}${path}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' }
      })
      if (res.status === 401) { tokens = null; await login(); return vwGet(path) }
      return res.json()
    }

    // --- Poll ---
    async function poll() {
      const { vin, email, password } = cfg()
      if (!email || !password) { setStatus('error', 'Email and password not configured'); return }

      try {
        setStatus('polling', 'Fetching vehicle data…')
        if (!tokens) await login()

        // Get vehicle list if no VIN configured
        let activeVin = vin
        if (!activeVin) {
          const vdata = await vwGet('/v1/vehicles')
          console.log('[weconnect-agent] Vehicles response:', JSON.stringify(vdata).slice(0, 200))
          activeVin = vdata?.data?.[0]?.vin || vdata?.vehicles?.[0]?.vin
          if (!activeVin) throw new Error('No VIN found — set one in config')
          api.updateConfig({ vin: activeVin })
        }

        // Fetch status
        const statusData = await vwGet(`/bs/vsr/v1/VW_PRD/vehicles/${activeVin}/status`)
        console.log('[weconnect-agent] Status response:', JSON.stringify(statusData).slice(0, 300))

        const vs = statusData?.StoredVehicleDataResponse?.vehicleData?.data || []

        // odometer field id 0x0101010002
        let odometer = null, level = null, levelType = 'fuel'
        for (const group of vs) {
          for (const field of group.field || []) {
            if (field.id === '0x0101010002') odometer = parseFloat(field.value)
            if (field.id === '0x030103000A') { level = parseFloat(field.value); levelType = 'fuel' }
            if (field.id === '0x0301030002') { level = parseFloat(field.value); levelType = 'soc'  }
          }
        }

        // Also try charging endpoint for EVs
        if (level == null) {
          try {
            const chg = await vwGet(`/bs/batterycharge/v1/VW_PRD/vehicles/${activeVin}/chargestatus`)
            const soc = chg?.chargeStatus?.stateOfCharge
            if (soc != null) { level = parseFloat(soc); levelType = 'soc' }
          } catch {}
        }

        const reading = { vin: activeVin, odometer, level, levelType, timestamp: new Date().toISOString() }
        lastReading = reading

        // Store in DB
        try {
          await api.db.insert({ vin: activeVin, odometer, level, level_type: levelType, recorded_at: reading.timestamp })
        } catch (e) { console.warn('[weconnect-agent] DB insert failed:', e.message) }

        emit('reading:new', reading)
        setStatus('idle', `Updated ${new Date().toLocaleTimeString()}`)

      } catch (e) {
        console.error('[weconnect-agent] Poll error:', e.message)
        setStatus('error', e.message)
        tokens = null // force re-auth next time
      }

      // Schedule next poll
      const mins = Math.max(5, cfg().pollIntervalMinutes || 30)
      pollTimer = setTimeout(poll, mins * 60 * 1000)
    }

    // Restore cached tokens if available
    const cached = cfg()._cachedTokens
    if (cached?.access_token && cached?.expires_at > Date.now()) {
      tokens = cached
      console.log('[weconnect-agent] Restored cached tokens ✓')
    }

    // Start polling after short delay
    setTimeout(poll, 2000)

    return {
      getLastReading: () => lastReading,
      getStatus:      () => lastStatus,
      pollNow:        () => { clearTimeout(pollTimer); setTimeout(poll, 0) }
    }
  }
})