export default function WhyMagnivo() {
    return (
        <section id="why" className="lp-section" style={{ background: 'var(--lp-bg-alt)' }}>
            <div className="lp-container">
                <div style={{ textAlign: 'center' }}>
                    <p className="lp-section-label">Differentiation</p>
                    <h2 className="lp-section-title">
                        Why <span className="lp-gradient-text">Magnivo AI</span>?
                    </h2>
                </div>

                <div className="lp-pillars">
                    <div className="lp-glass-card lp-pillar">
                        <div className="lp-pillar-icon">⚡</div>
                        <h3>Built for Speed</h3>
                        <p>
                            Sub-second page loads. Instant search. Real-time sync.
                            Your CRM should be faster than your reps — and it is.
                        </p>
                    </div>

                    <div className="lp-glass-card lp-pillar">
                        <div className="lp-pillar-icon">🤖</div>
                        <h3>AI Inside, Not Bolted On</h3>
                        <p>
                            Lead scoring, follow-up suggestions, and deal insights
                            are native to the product — not an upsell from a third party.
                        </p>
                    </div>

                    <div className="lp-glass-card lp-pillar">
                        <div className="lp-pillar-icon">🧩</div>
                        <h3>Simple Setup. No Consultants.</h3>
                        <p>
                            Import your data, invite your team, and start selling
                            in under 15 minutes. No onboarding fees. No training required.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}
