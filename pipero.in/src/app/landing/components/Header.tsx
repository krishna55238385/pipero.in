'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function Header() {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20)
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    return (
        <header className="lp-header" style={{ opacity: scrolled ? 1 : 0.95 }}>
            <div className="lp-header-inner">
                <Link href="/" className="lp-logo">
                    Magnivo <span>AI</span>
                </Link>

                <nav className="lp-nav">
                    <a href="#features">Features</a>
                    <a href="#pricing">Pricing</a>
                    <a href="#why">Why Magnivo AI</a>
                </nav>

                <div className="lp-header-cta">
                    <a href="https://calendly.com/krishnasuseel2001/pipero-io-demo" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary lp-btn-sm">Book a Demo</a>
                    <a href="/login" className="lp-btn lp-btn-primary lp-btn-sm">Sign In</a>
                </div>
            </div>
        </header>
    )
}
