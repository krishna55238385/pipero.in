export default function Problem() {
    return (
        <section className="lp-section">
            <div className="lp-container">
                <div style={{ textAlign: 'center' }}>
                    <p className="lp-section-label">The Problem</p>
                    <h2 className="lp-section-title">Most CRMs Slow You Down.</h2>
                    <p className="lp-section-subtitle" style={{ margin: '0 auto' }}>
                        Your team spends more time fighting the tool than closing deals.
                    </p>
                </div>

                <div className="lp-problem-cards">
                    <div className="lp-glass-card lp-problem-card">
                        <div className="lp-problem-icon">❌</div>
                        <h3>Too Complex</h3>
                        <p>
                            Enterprise CRMs were built for 10,000-person orgs. You don&apos;t need
                            47 tabs and a consultant to manage your pipeline.
                        </p>
                    </div>

                    <div className="lp-glass-card lp-problem-card">
                        <div className="lp-problem-icon">❌</div>
                        <h3>Too Manual</h3>
                        <p>
                            If your reps are spending more time logging data than selling, your
                            CRM is working against you — not for you.
                        </p>
                    </div>

                    <div className="lp-glass-card lp-problem-card">
                        <div className="lp-problem-icon">❌</div>
                        <h3>Too Expensive</h3>
                        <p>
                            $150/seat/month for features you&apos;ll never use. You need a CRM
                            that fits your team — and your budget.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}
