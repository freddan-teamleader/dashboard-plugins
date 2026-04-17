api.registerService({
  type: 'weconnect-agent',
  name: 'WeConnect Agent',
  description: 'Polls VW WeConnect API every 30 minutes for odometer and battery data',
  defaultConfig: {
    email: '',
    password: '',
    vin: '',
    pollIntervalMinutes: 30
  },
  events: {
    'reading:new': {
      description: 'New odometer/battery reading fetched',
      schema: { vin: 'string', odometer: 'number', soc: 'number', fuelLevel: 'number', ts: 'string' }
    },
    'status:change': {
      description: 'Agent status changed',
      schema: { status: 'string', message: 'string' }
    }
  },
  create() {
    let externalConfig = {}
    let accessToken = null
    let refreshToken = null
    let tokenExpiry = 0
    let pollTimer = null
    let status = 'idle'
    let lastError = null
    let lastReading = null

    function setStatus(s, msg = '') {
      status = s
      lastError = msg
      api.emit('weconnect-agent:status:change', { status: s, message: msg })
      console.log(`[weconnect-agent] ${s}: ${msg}`)
    }

    function cfg() {
      return Object.assign({}, api.config || {}, externalConfig)
    }

    async function authenticate() {
      const { email, password } = cfg()
      if (!email || !password) {
        setStatus('error', 'No credentials configured')
        return false
      }
      try {
        setStatus('authenticating', 'Starting login...')

        // Step 1: Get CSRF token from login page
        const authUrl = 'https://identity.vwgroup.io/oidc/v1/authorize' +
          '?client_id=9496332b-ea03-4091-930b-600d81e023cf' +
          '&scope=openid%20profile%20address%20email%20phone%20cars%20mbb%20vehicles%20vin' +
          '&response_type=code' +
          '&redirect_uri=weconnect%3A%2F%2Fauthenticated'

        const pageRes = await api.fetch(authUrl)
        const pageHtml = await pageRes.text()

        const csrfMatch = pageHtml.match(/name="_csrf"\s+value="([^"]+)"/)
        const relayMatch = pageHtml.match(/name="relayState"\s+value="([^"]+)"/)
        const hmacMatch = pageHtml.match(/name="hmac"\s+value="([^"]+)"/)
        const actionMatch = pageHtml.match(/action="([^"]+signin[^"]+)"/)

        if (!csrfMatch || !actionMatch) {
          setStatus('error', 'Could not parse VW login page')
          return false
        }

        const csrf = csrfMatch[1]
        const relay = relayMatch ? relayMatch[1] : ''
        const hmac = hmacMatch ? hmacMatch[1] : ''
        const actionUrl = actionMatch[1].replace(/&amp;/g, '&')

        // Step 2: POST credentials
        const formData = new URLSearchParams({
          _csrf: csrf,
          relayState: relay,
          hmac: hmac,
          email: email,
          password: password
        })

        const loginRes = await api.fetch(actionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        })

        const loginText = await loginRes.text()

        // Look for auth code in redirect or page
        const codeMatch = loginText.match(/code=([A-Za-z0-9_\-]+)/) ||
          loginRes.url?.match(/code=([A-Za-z0-9_\-]+)/)

        if (!codeMatch) {
          setStatus('error', 'Login failed — check email/password')
          return false
        }

        const code = codeMatch[1]

        // Step 3: Exchange code for token
        const tokenRes = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: 'weconnect://authenticated',
            client_id: '9496332b-ea03-4091-930b-600d81e023cf'
          }).toString()
        })

        const tokenData = await tokenRes.json()
        if (!tokenData.access_token) {
          setStatus('error', 'Token exchange failed: ' + JSON.stringify(tokenData))
          return false
        }

        accessToken = tokenData.access_token
        refreshToken = tokenData.refresh_token
        tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000
        setStatus('authenticated', 'Logged in successfully')
        return true
      } catch (e) {
        setStatus('error', 'Auth error: ' + e.message)
        return false
      }
    }

    async function ensureToken() {
      if (accessToken && Date.now() < tokenExpiry) return true
      if (refreshToken) {
        try {
          const res = await api.fetch('https://identity.vwgroup.io/oidc/v1/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: '9496332b-ea03-4091-930b-600d81e023cf'
            }).toString()
          })
          const data = await res.json()
          if (data.access_token) {
            accessToken = data.access_token
            refreshToken = data.refresh_token || refreshToken
            tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
            return true
          }
        } catch (e) { /* fall through to re-auth */ }
      }
      return await authenticate()
    }

    async function fetchVehicles() {
      const res = await api.fetch('https://mobileapi.apps.emea.vwapps.io/vehicles', {
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Accept': 'application/json'
        }
      })
      const data = await res.json()
      return data.data || data.vehicles || []
    }

    async function fetchReading(vin) {
      const headers = {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      }

      let odometer = null, soc = null, fuelLevel = null

      try {
        const odomRes = await api.fetch(
          `https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/measurements/odometerStatus`,
          { headers }
        )
        const odomData = await odomRes.json()
        odometer = odomData.data?.odometer?.value
          ?? odomData.odometer?.value
          ?? odomData.mileageKm
          ?? null
      } catch (e) {
        console.warn('[weconnect-agent] odometer fetch failed', e.message)
      }

      try {
        const battRes = await api.fetch(
          `https://mobileapi.apps.emea.vwapps.io/vehicles/${vin}/measurements/fuelStatus`,
          { headers }
        )
        const battData = await battRes.json()
        const tank = battData.data?.fuelStatus?.primaryFuelLevel
          ?? battData.data?.fuelStatus?.carCapturedTimestamp
        soc = battData.data?.batteryStatus?.currentSOC_pct
          ?? battData.data?.charging?.currentSOC_pct
          ?? null
        fuelLevel = battData.data?.fuelStatus?.primaryFuelLevel?.value
          ?? battData.data?.fuelStatus?.remainingRange_km
          ?? null
      } catch (e) {
        console.warn('[weconnect-agent] battery/fuel fetch failed', e.message)
      }

      return { vin, odometer, soc, fuelLevel, ts: new Date().toISOString() }
    }

    async function poll() {
      const c = cfg()
      if (!c.email || !c.password) {
        setStatus('error', 'No credentials — set email & password in widget Settings')
        return
      }

      setStatus('polling', 'Fetching data...')
      try {
        const ok = await ensureToken()
        if (!ok) return

        const vehicles = await fetchVehicles()
        let vin = c.vin

        if (!vin) {
          if (vehicles.length === 0) { setStatus('error', 'No vehicles found'); return }
          vin = vehicles[0].vin || vehicles[0].id
        }

        if (!vin) { setStatus('error', 'Could not determine VIN'); return }

        const reading = await fetchReading(vin)
        lastReading = reading

        // Store in api.db
        try {
          await api.db.insert({
            vin: reading.vin,
            odometer: reading.odometer,
            soc: reading.soc,
            fuel_level: reading.fuelLevel,
            recorded_at: reading.ts
          })
        } catch (e) {
          console.warn('[weconnect-agent] db insert failed', e.message)
        }

        api.emit('weconnect-agent:reading:new', reading)
        setStatus('ok', 'Last poll: ' + new Date().toLocaleTimeString())
      } catch (e) {
        setStatus('error', 'Poll error: ' + e.message)
      }

      // Schedule next poll
      const intervalMs = Math.max(5, (c.pollIntervalMinutes || 30)) * 60 * 1000
      pollTimer = setTimeout(poll, intervalMs)
    }

    // Start first poll after a short delay
    pollTimer = setTimeout(poll, 2000)

    return {
      setConfig(newConfig) {
        externalConfig = Object.assign({}, newConfig)
      },
      getStatus() {
        return { status, message: lastError, lastReading }
      },
      pollNow() {
        if (pollTimer) clearTimeout(pollTimer)
        poll()
      }
    }
  }
})