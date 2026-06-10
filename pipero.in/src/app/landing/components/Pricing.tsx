export default function Pricing() {
    const plans = [
        {
            name: 'Starter',
            desc: 'For founders and solo sellers.',
            price: '$19',
            features: [
                'Up to 500 leads',
                '1 user',
                'Pipeline management',
                'Email integration',
                'Basic analytics',
            ],
            featured: false,
        },
        {
            name: 'Growth',
            desc: 'For fast-scaling sales teams.',
            price: '$49',
            features: [
                'Unlimited leads',
                'Up to 10 users',
                'AI follow-up suggestions',
                'WhatsApp + Email sync',
                'Automation workflows',
                'Role-based access',
                'Priority support',
            ],
            featured: true,
        },
        {
            name: 'Scale',
            desc: 'For organizations that need it all.',
            price: '$99',
            features: [
                'Everything in Growth',
                'Unlimited users',
                'Custom roles & permissions',
                'Advanced analytics',
                'API access',
                'Dedicated account manager',
                'Custom integrations',
            ],
            featured: false,
        },
    ]

    return (
        <section id="pricing" className="lp-section">
            <div className="lp-container">
                <div style={{ textAlign: 'center' }}>
                    <p className="lp-section-label">Pricing</p>
                    <h2 className="lp-section-title">Simple, Transparent Pricing</h2>
                    <p className="lp-section-subtitle" style={{ margin: '0 auto' }}>
                        No hidden fees. No per-feature charges. Pick a plan and start closing.
                    </p>
                </div>

                <div className="lp-pricing-grid">
                    {plans.map((plan, i) => (
                        <div
                            key={i}
                            className={`lp-glass-card lp-pricing-card ${plan.featured ? 'lp-featured' : ''}`}
                        >
                            {plan.featured && <div className="lp-pricing-badge">Most Popular</div>}

                            <div className="lp-pricing-name">{plan.name}</div>
                            <div className="lp-pricing-desc">{plan.desc}</div>

                            <div className="lp-pricing-price">
                                <span className="lp-pricing-amount">{plan.price}</span>
                                <span className="lp-pricing-period"> /user /month</span>
                            </div>

                            <ul className="lp-pricing-features">
                                {plan.features.map((feature, j) => (
                                    <li key={j}>
                                        <span className="lp-pricing-check">
                                            <svg viewBox="0 0 24 24">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        </span>
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <a
                                href="/login"
                                className={`lp-btn ${plan.featured ? 'lp-btn-primary' : 'lp-btn-secondary'}`}
                            >
                                {plan.featured ? 'Start Free Trial' : 'Get Started'}
                            </a>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
