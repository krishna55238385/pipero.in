# Landing page → CRM leads (local)

When the **CRM runs locally** (`npm run dev` on port 3000), the landing page must POST to:

```text
http://localhost:3000/api/public/leads
```

If your landing page runs on a **different port** (e.g. 54600) or domain, use that full URL. Do **not** use a relative path like `/api/public/leads` or `/leads` — that would hit the landing page server, not the CRM, and can cause 408 timeouts or "Invalid JSON".

## Snippet for the landing page form (local CRM)

Replace `YOUR_CRM_URL` with `http://localhost:3000` when testing locally.

```javascript
const CRM_LEADS_URL = 'http://localhost:3000/api/public/leads'  // local
const TIMEOUT_MS = 15000  // 15 seconds

form.addEventListener('submit', async function (e) {
  e.preventDefault()
  const fd = new FormData(form)

  const payload = {
    company: fd.get('company') || 'MeraTutor AP Math',
    name: fd.get('student_name') || fd.get('name'),
    phone: (fd.get('phone') || '').toString().replace(/\D/g, '').slice(-10) || '',
    email: fd.get('email') || undefined,
    grade_level: fd.get('grade'),
    subject: 'AP Math',
    campaign: 'AP_MATH_LP',
    source: 'LP_AP_Math',
    utm: (() => {
      const p = new URLSearchParams(window.location.search)
      const u = {}
      ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => {
        const v = p.get(k)
        if (v) u[k] = v
      })
      u.full_url = window.location.href
      return u
    })()
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(CRM_LEADS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      alert('Submission failed: Invalid response from server. Is the CRM running at ' + CRM_LEADS_URL + '?')
      return
    }

    if (res.ok && json && json.success) {
      alert('Thanks! Your demo request has been received.')
      form.reset()
    } else {
      alert('Submission failed: ' + (json && json.error ? json.error : res.status + ' ' + res.statusText))
    }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      alert('Request timed out. Check that the CRM is running at ' + CRM_LEADS_URL)
    } else {
      alert('Network error. Check that the CRM is running and reachable at ' + CRM_LEADS_URL)
    }
  }
})
```

## Checklist

1. **CRM is running**: In a terminal, `cd e:\crm` and `npm run dev` (must be on port 3000).
2. **URL in the snippet**: Form must use `http://localhost:3000/api/public/leads` (same machine) or a tunnel URL if the landing page is on another device.
3. **Phone**: API requires at least **phone** or **email**. Normalize phone to digits (e.g. strip spaces and use last 10 digits).
4. **CORS**: The API allows `Access-Control-Allow-Origin: *`, so cross-origin POST from the landing page is allowed.
