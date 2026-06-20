'use client'

import { useState } from 'react'

export default function LeadCaptureForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const company = (fd.get('company') as string)?.trim() || ''
    const name = (fd.get('name') as string)?.trim() || ''
    const email = (fd.get('email') as string)?.trim() || ''
    const phone = (fd.get('phone') as string)?.trim() || ''

    if (!company) {
      setStatus('error')
      setMessage('Company or name is required.')
      return
    }
    if (!email && !phone) {
      setStatus('error')
      setMessage('Please enter your email or phone.')
      return
    }

    setStatus('loading')
    setMessage('')

    try {
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: company || 'Landing Page',
          name: name || undefined,
          email: email || undefined,
          phone: phone || undefined,
          source: 'Landing Page',
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setMessage(data.error || 'Something went wrong. Please try again.')
        return
      }
      setStatus('success')
      setMessage("We've got it! We'll be in touch soon.")
      form.reset()
    } catch {
      setStatus('error')
      setMessage('Network error. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div className="lp-lead-success">
        <p className="lp-lead-success-text">{message}</p>
        <button
          type="button"
          className="lp-btn lp-btn-secondary"
          onClick={() => setStatus('idle')}
        >
          Submit another
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="lp-lead-form">
      <div className="lp-lead-form-row">
        <input
          type="text"
          name="company"
          placeholder="Company name"
          className="lp-lead-input"
          disabled={status === 'loading'}
          required
        />
        <input
          type="text"
          name="name"
          placeholder="Your name"
          className="lp-lead-input"
          disabled={status === 'loading'}
        />
      </div>
      <div className="lp-lead-form-row">
        <input
          type="email"
          name="email"
          placeholder="Email"
          className="lp-lead-input"
          disabled={status === 'loading'}
        />
        <input
          type="tel"
          name="phone"
          placeholder="Phone (optional)"
          className="lp-lead-input"
          disabled={status === 'loading'}
        />
      </div>
      {message && (
        <p className={status === 'error' ? 'lp-lead-error' : 'lp-lead-message'}>
          {message}
        </p>
      )}
      <button
        type="submit"
        className="lp-btn lp-btn-primary"
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Sending…' : 'Get in touch'}
      </button>
    </form>
  )
}
