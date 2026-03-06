import LeadCaptureForm from './LeadCaptureForm'

export default function Footer() {
    return (
        <>
            {/* Final CTA + Lead capture */}
            <section className="lp-final-cta">
                <div className="lp-container">
                    <h2>
                        Stop Managing Deals.
                        <br />
                        <span className="lp-gradient-text">Start Closing Them.</span>
                    </h2>
                    <p>
                        Join thousands of sales teams who ditched the spreadsheet and
                        started selling smarter with Pipero.
                    </p>
                    <a href="/login" className="lp-btn lp-btn-primary" style={{ fontSize: 16, padding: '16px 40px' }}>
                        Get Started with Pipero
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </a>
                    <p className="lp-lead-cta-sub">Or leave your details and we&apos;ll reach out:</p>
                    <LeadCaptureForm />
                </div>
            </section>

            {/* Footer */}
            <footer className="lp-footer">
                <div className="lp-container">
                    <div className="lp-footer-inner">
                        <a href="/" className="lp-logo" style={{ fontSize: 18 }}>
                            Pipe<span>ro</span>
                        </a>

                        <div className="lp-footer-links">
                            <a href="#features">Features</a>
                            <a href="#pricing">Pricing</a>
                            <a href="#">Privacy</a>
                            <a href="#">Terms</a>
                        </div>

                        <div className="lp-footer-copy">
                            © {new Date().getFullYear()} Pipero.io — All rights reserved.
                        </div>
                    </div>
                </div>
            </footer>
        </>
    )
}
