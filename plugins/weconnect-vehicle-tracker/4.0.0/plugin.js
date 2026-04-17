// @bump: major
api.registerService({
  type: 'weconnect-agent',
  title: 'WeConnect Agent',
  description: 'Polls VW WeConnect API every N minutes',
  defaultConfig: {},
  events: {
    'reading:new':   { description: 'New odometer/battery reading', schema: { vin: 'string', odometer: 'number', level: 'number', levelType: 'string', ts: 'string' } },
    'status:change': { description: 'Agent status update',          schema: { status: 'string', message: 'string' } },
  },
  create() {
    let externalConfig = {}
    let status = { status: 'idle', message: 'Waiting for config' }
    let timer = null
    let accessToken = null
    let tokenExpiry = 0

    function setStatus(s, msg) {
      status = { status: s, message: msg }
      api.emit('weconnect-agent:status:change', status)
      console.log(`[weconnect-agent] ${s}: ${msg}`)
    }

    function cfg() {
      return {
        email: externalConfig.email || '',
        password: externalConfig.password || '',
        vin: externalConfig.vin || '',
        pollIntervalMinutes: Number(externalConfig.pollIntervalMinutes) || 30,
      }
    }

    async function authenticate() {
      const { email, password } = cfg()
      if (!email || !password) throw new Error('No credentials configured')

      setStatus('authenticating', 'Logging in to WeConnect…')

      // Step 1: Get login page and extract tokens
      const loginPageRes = await api.fetch(
        'https://identity.vwgroup.io/oidc/v1/authorize?' +
        'client_id=9496332b-ea03-4091-a224-8c746b885f5d%40apps_vw-dilab_com&' +
        'redirect_uri=weconnect%3A%2F%2Fauthenticated&' +
        'response_type=code&' +
        'scope=openid%20profile%20address%20cars%20dealers%20birthdate%20nationalIdentifier%20phone%20nickname%20email%20driversLicense%20mbb&' +
        'state=login'
      )
      const loginHtml = await loginPageRes.text()

      const actionMatch = loginHtml.match(/action="([^"]+)"/)
      const csrfMatch   = loginHtml.match(/name="_csrf"\s+value="([^"]+)"/)
      const relayMatch  = loginHtml.match(/name="relayState"\s+value="([^"]+)"/)
      const hmacMatch   = loginHtml.match(/name="hmac"\s+value="([^"]+)"/)

      if (!actionMatch) throw new Error('Could not parse login form — VW may have changed their auth page')

      const actionUrl = actionMatch[1].replace(/&amp;/g, '&')
      const csrf      = csrfMatch?.[1] || ''
      const relay     = relayMatch?.[1] || ''
      const hmac      = hmacMatch?.[1] || ''

      // Step 2: POST credentials
      const credRes = await api.fetch(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&_csrf=${encodeURIComponent(csrf)}&relayState=${encodeURIComponent(relay)}&hmac=${encodeURIComponent(hmac)}`,
        redirect: 'manual',
      })

      // Step 3: Follow redirects to extract auth code
      let code = null
      let location = credRes.headers?.get('location') || credRes.url || ''

      for (let i = 0; i < 10 && location && !code; i++) {
        const codeMatch = location.match(/[?&]code=([^&]+)/)
        if (codeMatch) { code = codeMatch[1]; break }
        if (!location.startsWith('http')) break
        const r = await api.fetch(location, { redirect: 'manual' })
        location = r.headers?.get('location') || ''
      }

      if (!code) throw new Error('Auth code not found in redirect chain — check credentials')

      // Step 4: Exchange code for tokens
      const tokenRes = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=weconnect%3A%2F%2Fauthenticated&client_id=9496332b-ea03-4091-a224-8c746b885f5d%40apps_vw-dilab_com`,
      })
      const tokenData = await tokenRes.json()
      if (!tokenData.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`)

      accessToken  = tokenData.access_token
      tokenExpiry  = Date.now() + (tokenData.expires_in || 3600) * 1000 - 60000
      setStatus('ok', 'Authenticated')
      return accessToken
    }

    async function getToken() {
      if (accessToken && Date.now() < tokenExpiry) return accessToken
      return authenticate()
    }

    async function fetchVehicles(token) {
      const res  = await api.fetch('https://mobileapi.apps.emea.vwapps.io/vehicles', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      const data = await res.json()
      return data.data || []
    }

    async function fetchStatus(token, vin) {
      const res  = await api.fetch(`https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/status`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      return res.json()
    }

    async function poll() {
      const { email, password, vin: cfgVin } = cfg()
      if (!email || !password) {
        setStatus('idle', 'Enter email & password in widget settings')
        return
      }
      try {
        setStatus('polling', 'Fetching vehicle data…')
        const token    = await getToken()
        const vehicles = await fetchVehicles(token)
        if (!vehicles.length) throw new Error('No vehicles found on this account')

        const vehicle  = cfgVin
          ? vehicles.find(v => v.vin === cfgVin) || vehicles[0]
          : vehicles[0]
        const vin      = vehicle.vin

        const statusData = await fetchStatus(token, vin)

        // Odometer
        const odometer = statusData?.data?.mileageKm
          || statusData?.mileageKm
          || statusData?.odometerMeasurement?.value
          || null

        // Battery / fuel
        let level     = null
        let levelType = 'battery'
        const soc     = statusData?.data?.charging?.batteryStatus?.currentSOC_pct
          ?? statusData?.charging?.batteryStatus?.currentSOC_pct
          ?? statusData?.batteryStatus?.currentSOC_pct
          ?? null
        const fuel    = statusData?.data?.fuelStatus?.rangeStatus?.primaryEngine?.currentFuelLevel_pct
          ?? statusData?.fuelStatus?.rangeStatus?.primaryEngine?.currentFuelLevel_pct
          ?? null

        if (soc  !== null) { level = soc;  levelType = 'battery' }
        else if (fuel !== null) { level = fuel; levelType = 'fuel' }

        const reading = { vin, odometer, level, levelType, ts: new Date().toISOString() }

        try {
          await api.db.insert(reading)
        } catch (e) {
          console.warn('[weconnect-agent] db.insert failed:', e.message)
        }

        api.emit('weconnect-agent:reading:new', reading)
        setStatus('ok', `Updated ${new Date().toLocaleTimeString()}`)
      } catch (err) {
        accessToken = null
        setStatus('error', err.message)
      }
    }

    function schedulePoll() {
      if (timer) clearInterval(timer)
      const mins = cfg().pollIntervalMinutes
      timer = setInterval(poll, mins * 60 * 1000)
    }

    // Kick off after 1 second so loader finishes
    setTimeout(() => {
      schedulePoll()
      poll()
    }, 1000)

    // ── Public API returned to widget ──────────────────────────────────────────
    const service = {
      setConfig(newCfg) {
        externalConfig = { ...newCfg }
        schedulePoll()
      },
      getStatus() {
        return { ...status }
      },
      pollNow() {
        return poll()
      },
    }

    return service
  }
})