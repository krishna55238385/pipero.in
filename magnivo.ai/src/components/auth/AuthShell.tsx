import { Fraunces } from 'next/font/google'

// Editorial display serif for the brand tagline — distinctive, premium, not the
// usual geometric-sans SaaS look. Body text stays on the app's Geist sans.
const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

/** Clerk theming so the auth card matches the Magnivo AI brand (blue, rounded, calm). */
export const clerkAppearance = {
  variables: {
    colorPrimary: '#2563eb',
    colorText: '#0f172a',
    colorTextSecondary: '#64748b',
    colorBackground: '#ffffff',
    borderRadius: '0.85rem',
    fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
  },
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full shadow-xl shadow-slate-300/40 rounded-3xl',
    card: 'rounded-3xl border border-slate-100 bg-white px-8 py-9',
    headerTitle: 'text-[1.45rem] font-semibold tracking-tight text-slate-900',
    headerSubtitle: 'text-slate-500',
    socialButtonsBlockButton:
      'rounded-xl border-slate-200 hover:bg-slate-50 transition-colors',
    formButtonPrimary:
      'rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/25 text-sm normal-case font-semibold',
    formFieldInput: 'rounded-xl border-slate-200 focus:border-blue-500',
    footerActionLink: 'text-blue-600 hover:text-blue-700 font-semibold',
  },
} as const

const FEATURES = [
  'AI lead discovery & ICP scoring',
  'Account & buying-committee intelligence',
  'Automated multichannel outreach',
]

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${display.variable} grid min-h-screen w-full lg:grid-cols-[1.05fr_1fr]`}
    >
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#070b16] px-14 py-12 text-white lg:flex">
        {/* atmospheric aurora */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-[26rem] w-[26rem] rounded-full bg-blue-600/30 blur-[120px] [animation:auth-float_14s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute -bottom-32 right-[-6rem] h-[28rem] w-[28rem] rounded-full bg-cyan-500/20 blur-[130px] [animation:auth-float_18s_ease-in-out_infinite_reverse]" />
        {/* fine dot-grid, fading toward the bottom */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.09) 1px, transparent 0)',
            backgroundSize: '26px 26px',
            maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)',
          }}
        />

        {/* wordmark */}
        <div
          className="relative z-10 flex items-center gap-2.5 [animation:auth-rise_.7s_cubic-bezier(.2,.7,.2,1)_both]"
          style={{ animationDelay: '40ms' }}
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-blue-500/30">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-5 4 4 8-8" />
              <path d="M16 8h5v5" />
            </svg>
          </span>
          <span className="text-lg font-semibold tracking-tight">Magnivo AI</span>
        </div>

        {/* headline */}
        <div className="relative z-10 max-w-md">
          <h1
            className="font-[family-name:var(--font-display)] text-[3.25rem] leading-[1.05] tracking-tight [animation:auth-rise_.7s_cubic-bezier(.2,.7,.2,1)_both]"
            style={{ animationDelay: '120ms' }}
          >
            Turn signals into{' '}
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
              pipeline.
            </span>
          </h1>
          <p
            className="mt-5 text-[0.95rem] leading-relaxed text-slate-300/90 [animation:auth-rise_.7s_cubic-bezier(.2,.7,.2,1)_both]"
            style={{ animationDelay: '200ms' }}
          >
            The AI go-to-market engine — find, understand, and reach your best
            accounts on autopilot.
          </p>

          <ul className="mt-9 space-y-3.5">
            {FEATURES.map((f, i) => (
              <li
                key={f}
                className="flex items-center gap-3 text-sm text-slate-200/90 [animation:auth-rise_.7s_cubic-bezier(.2,.7,.2,1)_both]"
                style={{ animationDelay: `${280 + i * 80}ms` }}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-500/15 ring-1 ring-inset ring-blue-400/30">
                  <svg viewBox="0 0 24 24" className="h-3 w-3 text-blue-300" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* footer */}
        <div
          className="relative z-10 text-xs text-slate-500 [animation:auth-rise_.7s_cubic-bezier(.2,.7,.2,1)_both]"
          style={{ animationDelay: '560ms' }}
        >
          © 2026 Magnivo AI · Secure sign-in
        </div>
      </aside>

      {/* ── Auth panel ──────────────────────────────────────────────── */}
      <main className="relative flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md">
          {/* compact wordmark for mobile (brand panel is hidden) */}
          <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l5-5 4 4 8-8" />
                <path d="M16 8h5v5" />
              </svg>
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-900">Magnivo AI</span>
          </div>
          <div className="flex justify-center [animation:auth-rise_.6s_cubic-bezier(.2,.7,.2,1)_both]">
            {children}
          </div>
        </div>
      </main>

      <style>{`
        @keyframes auth-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes auth-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(20px, -24px) scale(1.08); }
        }
      `}</style>
    </div>
  )
}
