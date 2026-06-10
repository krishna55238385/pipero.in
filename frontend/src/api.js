const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function apiFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

export function fetchSummary() {
  return apiFetch('/api/usage/summary')
}

export function fetchTimeline(days = 7) {
  return apiFetch(`/api/usage/timeline?days=${days}`)
}

export function fetchByIcp() {
  return apiFetch('/api/usage/by-icp')
}

export function fetchByPhase() {
  return apiFetch('/api/usage/by-phase')
}

export function fetchByAgent() {
  return apiFetch('/api/usage/by-agent')
}

export function fetchCalls({ limit = 20, offset = 0, agent = '', model = '' } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (agent) params.set('agent', agent)
  if (model) params.set('model', model)
  return apiFetch(`/api/usage/calls?${params}`)
}
