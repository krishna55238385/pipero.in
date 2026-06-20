export default function Features() {
    const features = [
        {
            title: 'Smart Lead Management',
            desc: 'Capture, score, and route leads automatically. Know exactly which deals deserve your attention.',
            icon: (
                <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            ),
        },
        {
            title: 'AI-Powered Follow-ups',
            desc: 'Never miss a touchpoint. Magnivo AI suggests the right message at the right time — automatically.',
            icon: (
                <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12" /><path d="M12 6v6l4 2" /><path d="M2 12h2" /></svg>
            ),
        },
        {
            title: 'Real-Time Revenue Tracking',
            desc: 'See your pipeline value, forecast, and team performance update live. No more stale spreadsheets.',
            icon: (
                <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>
            ),
        },
        {
            title: 'WhatsApp & Email Sync',
            desc: 'Your conversations, one inbox. Sync WhatsApp, email, and calls directly into every lead record.',
            icon: (
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            ),
        },
        {
            title: 'Role-Based Access',
            desc: 'Give every rep exactly the right level of access. Protect sensitive data without slowing anyone down.',
            icon: (
                <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            ),
        },
        {
            title: 'Automation Workflows',
            desc: 'Build trigger-action flows in minutes. Automate lead assignment, status updates, and notifications.',
            icon: (
                <svg viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
            ),
        },
    ]

    return (
        <section id="features" className="lp-section" style={{ background: 'var(--lp-bg-alt)' }}>
            <div className="lp-container">
                <div style={{ textAlign: 'center' }}>
                    <p className="lp-section-label">Features</p>
                    <h2 className="lp-section-title">
                        Everything Your Pipeline Needs.
                        <br />
                        <span className="lp-gradient-text">Nothing It Doesn&apos;t.</span>
                    </h2>
                </div>

                <div className="lp-features-grid">
                    {features.map((f, i) => (
                        <div key={i} className="lp-glass-card lp-feature-card">
                            <div className="lp-feature-icon">{f.icon}</div>
                            <h3>{f.title}</h3>
                            <p>{f.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
