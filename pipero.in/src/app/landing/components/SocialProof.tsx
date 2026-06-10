export default function SocialProof() {
    return (
        <section className="lp-section lp-social">
            <div className="lp-container">
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <p className="lp-section-label">Built for Teams That Move Fast</p>
                </div>

                {/* Logo Bar */}
                <div className="lp-logos">
                    <span className="lp-logo-item">▲ Nexova</span>
                    <span className="lp-logo-item">◆ Stackline</span>
                    <span className="lp-logo-item">● RevenueOS</span>
                    <span className="lp-logo-item">■ FlowHQ</span>
                    <span className="lp-logo-item">⬡ ClosedLoop</span>
                    <span className="lp-logo-item">◎ VelocityAI</span>
                </div>

                {/* Metrics */}
                <div className="lp-metrics">
                    <div className="lp-metric lp-glass-card">
                        <div className="lp-metric-value lp-gradient-text">32%</div>
                        <div className="lp-metric-label">Faster deal cycles</div>
                    </div>
                    <div className="lp-metric lp-glass-card">
                        <div className="lp-metric-value lp-gradient-text">18%</div>
                        <div className="lp-metric-label">Higher close rate</div>
                    </div>
                    <div className="lp-metric lp-glass-card">
                        <div className="lp-metric-value lp-gradient-text">4.2x</div>
                        <div className="lp-metric-label">ROI in first quarter</div>
                    </div>
                </div>

                {/* Testimonials */}
                <div className="lp-testimonials">
                    <div className="lp-glass-card lp-testimonial">
                        <p className="lp-testimonial-text">
                            &ldquo;We switched from HubSpot to Magnivo AI and our reps actually started using the CRM.
                            Deal velocity went up 40% in the first month.&rdquo;
                        </p>
                        <div className="lp-testimonial-author">
                            <div className="lp-testimonial-avatar">JK</div>
                            <div>
                                <div className="lp-testimonial-name">James Kim</div>
                                <div className="lp-testimonial-role">VP Sales, Nexova</div>
                            </div>
                        </div>
                    </div>
                    <div className="lp-glass-card lp-testimonial">
                        <p className="lp-testimonial-text">
                            &ldquo;The AI follow-up suggestions alone save each rep 5+ hours per week.
                            It&apos;s like having a sales ops team built into the product.&rdquo;
                        </p>
                        <div className="lp-testimonial-author">
                            <div className="lp-testimonial-avatar">SR</div>
                            <div>
                                <div className="lp-testimonial-name">Sarah Rodriguez</div>
                                <div className="lp-testimonial-role">Head of Growth, Stackline</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
