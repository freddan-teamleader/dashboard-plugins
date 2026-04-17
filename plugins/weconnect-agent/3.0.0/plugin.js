// @bump: major
api.registerService({
  type: 'weconnect-agent',
  title: 'WeConnect Agent',
  description: 'Authenticates with VW WeConnect and polls vehicle data every 30 min',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30,
    localBridgeUrl: 'http://localhost:4050'
  },
  events: {
    'reading:new':    { description: 'New odometer/level reading', schema: { vin: 'string', odometer: 'number', level: 'number', levelType: 'string', timestamp: 'string' } },
    'status:change':  { description: 'Agent status update',        schema: { status: 'string', message: 'string' } }
  },
  create() {
    const CLIENT_ID   = 'a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com'
    const REDIRECT_URI = 'weconnect://authenticated'
    const IDENTITY    = 'https://identity.vwgroup.io'

    let tokens       = null   // { access_token, refresh_token, expires_at }
    let lastReading  = null
    let agentStatus  = { status: 'idle', message: 'Not started' }
    let pollTimer    = null

    const cfg = () => api.config || {}

    function setStatus(status, message) {
      agentStatus = { status, message }
      api.emit('weconnect-agent:status:change', agentStatus)
      console.log(`[weconnect-agent] ${status}: ${message}`)
    }

    // ── PKCE ────────────────────────────────────────────────────────────────
    async function generatePKCE() {
      const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
      const digest   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
      return { verifier, challenge }
    }

    // ── Auth ─────────────────────────────────────────────────────────────────
    async function login() {
      const { email, password } = cfg()
      if (!email || !password) throw new Error('Email and password not configured')

      const { verifier, challenge } = await generatePKCE()
      const state = crypto.randomUUID()

      setStatus('polling', 'Step 1: fetching login form…')

      // Step 1: GET authorize → extract form fields from HTML
      const authUrl = `${IDENTITY}/oidc/v1/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('openid profile address phone email mbb offline_access')}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`
      const r1   = await api.fetch(authUrl)
      const html1 = await r1.text()

      const csrf       = html1.match(/name="_csrf"\s+value="([^"]+)"/)?.[1]
            || html1.match(/value="([^"]+)"\s+name="_csrf"/)?.[1]
      const relayState = html1.match(/name="relayState"\s+value="([^"]+)"/)?.[1]
            || html1.match(/value="([^"]+)"\s+name="relayState"/)?.[1]
      const hmac1      = html1.match(/name="hmac"\s+value="([^"]+)"/)?.[1]
            || html1.match(/value="([^"]+)"\s+name="hmac"/)?.[1]

      if (!csrf || !relayState || !hmac1)
        throw new Error(`Login form parse failed. csrf=${csrf} relay=${relayState} hmac=${hmac1}`)

      setStatus('polling', 'Step 2: submitting email…')

      // Step 2: POST email
      const r2 = await api.fetch(
        `${IDENTITY}/signin-service/v1/${CLIENT_ID}/login/identifier`,
        { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf, relayState, email, hmac: hmac1 }).toString() }
      )
      const html2 = await r2.text()
      const hmac2 = html2.match(/name="hmac"\s+value="([^"]+)"/)?.[1]
             || html2.match(/value="([^"]+)"\s+name="hmac"/)?.[1]

      if (!hmac2) throw new Error('Password form parse failed — hmac2 not found')

      setStatus('polling', 'Step 3: submitting password…')

      // Step 3: POST password — proxy follows redirects; final URL has code= OR body has JS redirect
      const r3 = await api.fetch(
        `${IDENTITY}/signin-service/v1/${CLIENT_ID}/login/authenticate`,
        { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf, relayState, email, password, hmac: hmac2 }).toString() }
      )
      const body3 = await r3.text()

      // Extract code from final URL (proxy rewrites weconnect:// → may appear in body as JS redirect)
      let code = null
      // Try r3.url first (if proxy followed and exposed final URL)
      try {
        const u = new URL((r3.url || '').replace('weconnect://', 'https://dummy/'))
        code = u.searchParams.get('code')
      } catch {}
      // Try body for JS location.href = "weconnect://authenticated?code=..."
      if (!code) {
        const m = body3.match(/[?&]code=([^"&\s]+)/)
        if (m) code = m[1]
      }
      // Try Location header if proxy exposed it
      if (!code) {
        const loc = r3.headers?.get?.('location') || ''
        const m = loc.match(/[?&]code=([^"&\s]+)/)
        if (m) code = m[1]
      }

      if (!code) {
        console.warn('[weconnect-agent] body3 snippet:', body3.slice(0, 500))
        throw new Error('Auth code not found in redirect. Check credentials.')
      }

      setStatus('polling', 'Step 4: exchanging code for tokens…')

      // Step 4: exchange code for tokens
      const r4 = await api.fetch(`${IDENTITY}/oidc/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  REDIRECT_URI,
          client_id:     CLIENT_ID,
          code_verifier: verifier
        }).toString()
      })
      const t = await r4.json()
      if (!t.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(t)}`)

      tokens = { ...t, expires_at: Date.now() + (t.expires_in || 3600) * 1000 }
      console.log('[weconnect-agent] ✅ Authenticated, token expires', new Date(tokens.expires_at).toLocaleTimeString())
      return tokens
    }

    async function refreshTokens() {
      if (!tokens?.refresh_token) { tokens = null; return login() }
      const r = await api.fetch(`${IDENTITY}/oidc/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id:     CLIENT_ID
        }).toString()
      })
      const t = await r.json()
      if (!t.access_token) { tokens = null; return login() }
      tokens = { ...tokens, ...t, expires_at: Date.now() + (t.expires_in || 3600) * 1000 }
    }

    async function ensureTokens() {
      if (!tokens) return login()
      if (Date.now() > tokens.expires_at - 60_000) return refreshTokens()
    }

    // ── Vehicle data via local bridge ────────────────────────────────────────
    async function vehicleFetch(path) {
      await ensureTokens()
      const base = (cfg().localBridgeUrl || 'http://localhost:4050').replace(/\/$/, '')
      const res  = await api.fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })
      if (res.status === 401) {
        tokens = null
        await login()
        return vehicleFetch(path)
      }
      return res.json()
    }

    async function getVehicles() {
      const data = await vehicleFetch('/vehicles')
      return data.data || data.vehicles || []
    }

    // ── Poll ─────────────────────────────────────────────────────────────────
    async function poll() {
      const { email, password, vin: cfgVin } = cfg()
      if (!email || !password) {
        setStatus('error', 'Email and password not configured — open Settings')
        return
      }

      setStatus('polling', 'Polling WeConnect…')
      try {
        await ensureTokens()

        // Resolve VIN
        let vin = cfgVin
        if (!vin) {
          const vehicles = await getVehicles()
          if (!vehicles.length) throw new Error('No vehicles found on account')
          vin = vehicles[0].vin
        }

        // Fetch status
        const statusData   = await vehicleFetch(`/vehicles/${vin}/status`)
        const chargingData = await vehicleFetch(`/vehicles/${vin}/charging`).catch(() => null)

        // Parse odometer
        const odometer = statusData?.data?.mileageInKm
          ?? statusData?.mileageInKm
          ?? statusData?.data?.mileage
          ?? null

        // Parse level — battery SoC first, then fuel
        let level = null, levelType = 'battery'
        const soc = chargingData?.data?.batteryStatus?.currentSOC_pct
          ?? chargingData?.data?.currentSOC_pct
          ?? statusData?.data?.batteryStatus?.currentSOC_pct
          ?? null
        const fuel = statusData?.data?.fuelLevel?.currentFuelLevel_pct
          ?? statusData?.data?.fuelLevelInPercent
          ?? null

        if (soc != null)        { level = soc;  levelType = 'battery' }
        else if (fuel != null)  { level = fuel; levelType = 'fuel' }

        const reading = { vin, odometer, level, levelType, timestamp: new Date().toISOString() }
        lastReading = reading

        // Store in DB
        try {
          await api.db.insert({ vin, odometer, level, level_type: levelType, recorded_at: reading.timestamp })
        } catch (e) { console.warn('[weconnect-agent] DB insert failed:', e.message) }

        api.emit('weconnect-agent:reading:new', reading)
        setStatus('idle', `Updated ${new Date().toLocaleTimeString()} — odo ${odometer?.toLocaleString()} km`)

      } catch (e) {
        console.error('[weconnect-agent] poll error:', e)
        setStatus('error', e.message)
      }
    }

    // ── Scheduler ────────────────────────────────────────────────────────────
    function schedulePoll() {
      if (pollTimer) clearInterval(pollTimer)
      const mins = Math.max(5, Number(cfg().pollIntervalMinutes) || 30)
      pollTimer = setInterval(poll, mins * 60_000)
      console.log(`[weconnect-agent] polling every ${mins} min`)
    }

    setTimeout(() => { poll(); schedulePoll() }, 2000)

    return {
      pollNow:        () => poll(),
      getLastReading: () => lastReading,
      getStatus:      () => agentStatus,
    }
  }
})