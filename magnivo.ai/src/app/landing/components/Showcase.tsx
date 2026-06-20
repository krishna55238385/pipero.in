'use client'

import { useEffect, useRef } from 'react'

export default function Showcase() {
    const sectionRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('lp-visible')
                    }
                })
            },
            { threshold: 0.15 }
        )

        const items = sectionRef.current?.querySelectorAll('.lp-reveal')
        items?.forEach((item) => observer.observe(item))

        return () => observer.disconnect()
    }, [])

    return (
        <section className="lp-section" ref={sectionRef}>
            <div className="lp-container">
                <div style={{ textAlign: 'center' }}>
                    <p className="lp-section-label">Product</p>
                    <h2 className="lp-section-title">See It in Action</h2>
                    <p className="lp-section-subtitle" style={{ margin: '0 auto' }}>
                        Every screen designed for speed. Every interaction built for clarity.
                    </p>
                </div>

                <div className="lp-showcase-items">
                    {/* Kanban Pipeline */}
                    <div className="lp-showcase-item lp-reveal">
                        <div>
                            <span className="lp-showcase-label">Pipeline View</span>
                            <h3>Drag. Drop. Close.</h3>
                            <p>
                                Visualize every deal across stages. Move cards with a gesture,
                                update status instantly, and never lose track of where a deal stands.
                            </p>
                        </div>
                        <div className="lp-showcase-mockup">
                            <div className="lp-showcase-mockup-content">
                                <div className="lp-kanban-mock">
                                    <div className="lp-kanban-col">
                                        <div className="lp-kanban-col-title">New Leads</div>
                                        <div className="lp-kanban-item">
                                            Acme Corp
                                            <div className="lp-kanban-item-sub">$45K · Sarah R.</div>
                                        </div>
                                        <div className="lp-kanban-item">
                                            TechFlow
                                            <div className="lp-kanban-item-sub">$28K · Mike J.</div>
                                        </div>
                                    </div>
                                    <div className="lp-kanban-col">
                                        <div className="lp-kanban-col-title">Qualified</div>
                                        <div className="lp-kanban-item">
                                            Zenith AI
                                            <div className="lp-kanban-item-sub">$120K · Lisa M.</div>
                                        </div>
                                    </div>
                                    <div className="lp-kanban-col">
                                        <div className="lp-kanban-col-title">Proposal</div>
                                        <div className="lp-kanban-item">
                                            DataSync
                                            <div className="lp-kanban-item-sub">$85K · Tom W.</div>
                                        </div>
                                        <div className="lp-kanban-item">
                                            CloudNine
                                            <div className="lp-kanban-item-sub">$62K · Ana P.</div>
                                        </div>
                                    </div>
                                    <div className="lp-kanban-col">
                                        <div className="lp-kanban-col-title">Closed Won ✓</div>
                                        <div className="lp-kanban-item" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
                                            Bolt Inc
                                            <div className="lp-kanban-item-sub">$156K · James K.</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Analytics Dashboard */}
                    <div className="lp-showcase-item lp-reveal">
                        <div>
                            <span className="lp-showcase-label">Analytics</span>
                            <h3>Data That Drives Decisions</h3>
                            <p>
                                Real-time dashboards that show what matters. Revenue trends,
                                rep performance, and pipeline health — all in one view.
                            </p>
                        </div>
                        <div className="lp-showcase-mockup">
                            <div className="lp-showcase-mockup-content">
                                <div className="lp-analytics-mock">
                                    <div className="lp-analytics-row">
                                        <div className="lp-analytics-stat">
                                            <div className="lp-analytics-stat-label">MRR</div>
                                            <div className="lp-analytics-stat-value lp-gradient-text">$42K</div>
                                        </div>
                                        <div className="lp-analytics-stat">
                                            <div className="lp-analytics-stat-label">Deals</div>
                                            <div className="lp-analytics-stat-value">127</div>
                                        </div>
                                        <div className="lp-analytics-stat">
                                            <div className="lp-analytics-stat-label">Win Rate</div>
                                            <div className="lp-analytics-stat-value" style={{ color: '#22c55e' }}>68%</div>
                                        </div>
                                        <div className="lp-analytics-stat">
                                            <div className="lp-analytics-stat-label">Avg Cycle</div>
                                            <div className="lp-analytics-stat-value">14d</div>
                                        </div>
                                    </div>
                                    <div className="lp-chart-bars">
                                        {[60, 45, 70, 55, 80, 65, 90, 75, 85, 70, 95, 88].map((h, i) => (
                                            <div
                                                key={i}
                                                className="lp-chart-bar"
                                                style={{ height: `${h}%`, animationDelay: `${i * 0.05}s` }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Lead Detail */}
                    <div className="lp-showcase-item lp-reveal">
                        <div>
                            <span className="lp-showcase-label">Lead Detail</span>
                            <h3>360° Lead Intelligence</h3>
                            <p>
                                Every touchpoint, email, call, and note — all in one timeline.
                                AI enrichment fills in the gaps so your reps sell, not research.
                            </p>
                        </div>
                        <div className="lp-showcase-mockup">
                            <div className="lp-showcase-mockup-content" style={{ gap: '10px' }}>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px', background: 'var(--lp-bg)', borderRadius: '12px', border: '1px solid var(--lp-border)' }}>
                                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--lp-accent), var(--lp-gradient-end))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>AC</div>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 14 }}>Acme Corporation</div>
                                        <div style={{ fontSize: 11, color: 'var(--lp-text-muted)' }}>Sarah Rodriguez · VP Sales · San Francisco</div>
                                    </div>
                                </div>
                                {[
                                    { time: '2h ago', action: '📧 Email opened: "Q4 Pricing Proposal"' },
                                    { time: '1d ago', action: '📞 Call logged: 12 min · Discussed implementation' },
                                    { time: '3d ago', action: '🤖 AI: Lead score increased to 92/100' },
                                    { time: '5d ago', action: '📄 Proposal sent: $45,000 annual deal' },
                                ].map((item, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '12px', fontSize: 12, padding: '8px 12px', background: 'var(--lp-bg)', borderRadius: '8px', border: '1px solid var(--lp-border)' }}>
                                        <span style={{ color: 'var(--lp-text-muted)', fontSize: 10, fontWeight: 600, minWidth: 42, flexShrink: 0 }}>{item.time}</span>
                                        <span style={{ fontWeight: 500 }}>{item.action}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Automation Builder */}
                    <div className="lp-showcase-item lp-reveal">
                        <div>
                            <span className="lp-showcase-label">Automations</span>
                            <h3>Set It. Forget It. Close.</h3>
                            <p>
                                Build trigger-action workflows visually. Lead comes in hot?
                                Auto-assign, auto-notify, auto-follow-up. Zero manual work.
                            </p>
                        </div>
                        <div className="lp-showcase-mockup">
                            <div className="lp-showcase-mockup-content" style={{ gap: 16, justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320, margin: '0 auto' }}>
                                    {[
                                        { label: 'TRIGGER', text: 'New lead from website', color: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.25)' },
                                        { label: 'CONDITION', text: 'Score > 80 AND Source = "Inbound"', color: 'rgba(234,179,8,0.1)', border: 'rgba(234,179,8,0.25)' },
                                        { label: 'ACTION', text: 'Assign to top rep + Send welcome email', color: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.25)' },
                                        { label: 'ACTION', text: 'Create follow-up task in 2 days', color: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.25)' },
                                    ].map((step, i) => (
                                        <div key={i}>
                                            <div style={{ background: step.color, border: `1px solid ${step.border}`, borderRadius: 10, padding: '10px 14px' }}>
                                                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--lp-text-muted)', marginBottom: 4 }}>{step.label}</div>
                                                <div style={{ fontSize: 12, fontWeight: 600 }}>{step.text}</div>
                                            </div>
                                            {i < 3 && (
                                                <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                                                    <svg width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="var(--lp-text-muted)" strokeWidth="1.5">
                                                        <path d="M6 0v12M2 8l4 4 4-4" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
