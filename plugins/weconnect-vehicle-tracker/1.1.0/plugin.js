api.registerService({
  type: 'weconnect-agent',
  title: 'WeConnect Agent',
  description: 'Polls WeConnect every 30 min for odometer and battery/fuel data',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  events: {
    'reading:new': {
      description: 'New vehicle reading fetched',
      schema: { vin: 'string', odometer: 'number', level: 'number', level_type: 'string', recorded_at: 'string' }
    }
  },
  create() {
    let accessToken  = null
    let refreshToken = null
    let tokenExpiry  = 0
    let activeVin    = null
    let pollTimer    = null

    // ── Auth helpers ──────────────────────────────────────────────────────────
    async function authenticate() {
      const cfg = api.getConfig()
      if (!cfg.email || !cfg.password) throw new Error('Email and password required in config')

      // Step 1: Get login page
      const authRes = await api.fetch(
        'https://identity.vwgroup.io/oidc/v1/authorize' +
        '?client_id=a24fba63-34b3-4d43-b181-942111e37f9b%40apps_vw-dilab_com' +
        '&redirect_uri=weconnect%3A%2F%2Fauthenticated' +
        '&response_type=code' +
        '&scope=openid%20profile%20address%20email%20phone%20cars%20dealers%20mbb%20mbboauth_v1',
        { credentials: 'omit' }
      )
      const html1 = await authRes.text()

      // Extract form action + hidden fields
      const actionMatch = html1.match(/action="([^"]+)"/)
      const csrfMatch   = html1.match(/name="_csrf"\s+value="([^"]+)"/)
      const relayMatch  = html1.match(/name="relayState"\s+value="([^"]+)"/)
      const hmacMatch   = html1.match(/name="hmac"\s+value="([^"]+)"/)
      if (!actionMatch) throw new Error('Could not parse WeConnect login page')

      const loginAction = actionMatch[1].startsWith('http')
        ? actionMatch[1]
        : 'https://identity.vwgroup.io' + actionMatch[1]

      // Step 2: POST credentials
      const body = new URLSearchParams({
        email:      cfg.email,
        password:   cfg.password,
        ...(csrfMatch  ? { _csrf:      csrfMatch[1]  } : {}),
        ...(relayMatch ? { relayState: relayMatch[1] } : {}),
        ...(hmacMatch  ? { hmac:       hmacMatch[1]  } : {})
      })

      const loginRes = await api.fetch(loginAction, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:        body.toString(),
        credentials: 'omit',
        redirect:    'manual'
      })

      // Step 3: Chase redirects to find code
      let code     = null
      let location = loginRes.headers.get('location') || ''
      for (let i = 0; i < 10 && location && !code; i++) {
        const codeMatch = location.match(/[?&]code=([^&]+)/)
        if (codeMatch) { code = codeMatch[1]; break }
        const r = await api.fetch(location, { credentials: 'omit', redirect: 'manual' })
        location = r.headers.get('location') || ''
      }
      if (!code) throw new Error('Could not obtain auth code from WeConnect')

      // Step 4: Exchange code for tokens
      const tokenRes = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          redirect_uri: 'weconnect://authenticated',
          client_id:    'a24fba63-34b3-4d43-b181-942111e37f9b@apps_vw-dilab_com'
        }).toString(),
        credentials: 'omit'
      })
      const tokens = await tokenRes.json()
      if (!tokens.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(tokens))

      accessToken  = tokens.access_token
      refreshToken = tokens.refresh_token
      tokenExpiry  = Date.now() + (tokens.expires_in - 60) * 1000
    }

    async function ensureToken() {
      if (accessToken && Date.now() < tokenExpiry) return
      if (refreshToken) {
        try {
          const r = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type:    'refresh_token',
              refresh_token: refreshToken,
              client_id:     'a24fba63-34b3-4d43-b181-942111e37f9b@apps_vw-dilab_com'
            }).toString(),
            credentials: 'omit'
          })
          const t = await r.json()
          if (t.access_token) {
            accessToken  = t.access_token
            refreshToken = t.refresh_token || refreshToken
            tokenExpiry  = Date.now() + (t.expires_in - 60) * 1000
            return
          }
        } catch (_) {}
      }
      await authenticate()
    }

    // ── Vehicle data ──────────────────────────────────────────────────────────
    async function resolveVin() {
      const cfg = api.getConfig()
      if (cfg.vin) return cfg.vin
      if (activeVin) return activeVin
      await ensureToken()
      const r    = await api.fetch('https://mobileapi.apps.emea.vwapps.io/vehicles', {
        headers: { Authorization: 'Bearer ' + accessToken }
      })
      const data = await r.json()
      const vehicles = data.data || data.vehicles || data
      if (!vehicles?.length) throw new Error('No vehicles found on account')
      activeVin = vehicles[0].vin
      return activeVin
    }

    async function fetchReading() {
      await ensureToken()
      const vin = await resolveVin()

      // Try EV endpoint first, fall back to fuel
      let odometer = null, level = null, levelType = 'battery'

      try {
        const r    = await api.fetch(
          `https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/selectivestatus?jobs=measurements,charging`,
          { headers: { Authorization: 'Bearer ' + accessToken } }
        )
        const d = await r.json()
        const measurements = d?.measurements?.value || d?.measurements || {}
        const mileage = measurements?.mileageKm?.value ?? measurements?.odometer?.value
        if (mileage != null) odometer = mileage
        const soc = d?.charging?.value?.batteryStatus?.value?.currentSOC_pct
          ?? d?.charging?.value?.chargingStatus?.value?.chargePower_kW
        if (soc != null) { level = soc; levelType = 'battery' }
      } catch (_) {}

      if (level == null) {
        try {
          const r    = await api.fetch(
            `https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/selectivestatus?jobs=measurements`,
            { headers: { Authorization: 'Bearer ' + accessToken } }
          )
          const d = await r.json()
          const fl = d?.measurements?.value?.fuelLevelPct?.value
          if (fl != null) { level = fl; levelType = 'fuel' }
          const od = d?.measurements?.value?.mileageKm?.value
          if (od != null) odometer = od
        } catch (_) {}
      }

      if (odometer == null && level == null) throw new Error('No vehicle data returned from API')

      const reading = {
        vin,
        odometer,
        level,
        level_type: levelType,
        recorded_at: new Date().toISOString()
      }

      // Store in db
      try { await api.db.insert(reading) } catch (_) {}

      // Emit event
      api.emit('weconnect-agent:reading:new', reading)

      return reading
    }

    // ── Polling loop ──────────────────────────────────────────────────────────
    function startPolling() {
      const cfg      = api.getConfig()
      const minutes  = Math.max(5, cfg.pollIntervalMinutes || 30)
      clearInterval(pollTimer)
      pollTimer = setInterval(() => { fetchReading().catch(console.error) }, minutes * 60 * 1000)
      fetchReading().catch(console.error)
    }

    startPolling()

    // ── Public API ────────────────────────────────────────────────────────────
    const publicAPI = {
      poll: async function() {
        return await fetchReading()
      }
    }

    console.log('[WeConnect Agent] created, publicAPI:', publicAPI)
    return publicAPI
  }
})