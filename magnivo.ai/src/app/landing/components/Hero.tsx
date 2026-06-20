export default function Hero() {
    return (
        <section className="lp-hero">
            <div className="lp-container">
                <div className="lp-hero-content">
                    {/* Left — Copy */}
                    <div>
                        <h1>
                            Pipeline,
                            <br />
                            <span className="lp-gradient-text">Simplified.</span>
                        </h1>

                        <p className="lp-hero-sub">
                            Magnivo AI helps growing sales teams track deals, automate follow-ups,
                            and close faster — without the chaos.
                        </p>

                        <div className="lp-hero-ctas">
                            <a href="/login" className="lp-btn lp-btn-primary">
                                Get Started
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                            </a>
                            <a href="https://calendly.com/krishnasuseel2001/pipero-io-demo" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary">
                                Book a Demo
                            </a>
                        </div>

                        <div className="lp-hero-trust">
                            <div className="lp-hero-trust-dots">
                                <span className="lp-hero-trust-dot" />
                            </div>
                            <span>No credit card required · Free 14-day trial</span>
                        </div>
                    </div>

                    {/* Right — Dashboard Mockup */}
                    <div className="lp-mockup">
                        <div className="lp-mockup-frame">
                            <div className="lp-mockup-bar">
                                <span /><span /><span />
                            </div>

                            <div className="lp-mockup-content">
                                {/* Metric Cards */}
                                <div className="lp-mockup-card">
                                    <div className="lp-mockup-card-label">Revenue</div>
                                    <div className="lp-mockup-card-value lp-gradient-text">$284K</div>
                                </div>
                                <div className="lp-mockup-card">
                                    <div className="lp-mockup-card-label">Close Rate</div>
                                    <div className="lp-mockup-card-value" style={{ color: '#22c55e' }}>68%</div>
                                </div>

                                {/* Pipeline */}
                                <div className="lp-mockup-pipeline">
                                    <div className="lp-mockup-card-label">Deal Pipeline</div>
                                    <div className="lp-pipeline-cols">
                                        <div className="lp-pipeline-col">
                                            <div className="lp-pipeline-col-label">New</div>
                                            <div className="lp-pipeline-item">Acme Corp</div>
                                            <div className="lp-pipeline-item">TechFlow</div>
                                        </div>
                                        <div className="lp-pipeline-col">
                                            <div className="lp-pipeline-col-label">Qualified</div>
                                            <div className="lp-pipeline-item">Zenith AI</div>
                                        </div>
                                        <div className="lp-pipeline-col">
                                            <div className="lp-pipeline-col-label">Proposal</div>
                                            <div className="lp-pipeline-item">DataSync</div>
                                            <div className="lp-pipeline-item">CloudNine</div>
                                        </div>
                                        <div className="lp-pipeline-col">
                                            <div className="lp-pipeline-col-label">Won</div>
                                            <div className="lp-pipeline-item" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>Bolt Inc ✓</div>
                                        </div>
                                    </div>
                                </div>

                                {/* AI Suggestion */}
                                <div className="lp-mockup-ai">
                                    <span className="lp-ai-dot" />
                                    <span>AI: Follow up with Acme Corp — decision expected this week</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
