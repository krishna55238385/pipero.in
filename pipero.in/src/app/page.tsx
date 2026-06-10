import './landing/landing.css'
import Header from './landing/components/Header'
import Hero from './landing/components/Hero'
import SocialProof from './landing/components/SocialProof'
import Problem from './landing/components/Problem'
import Features from './landing/components/Features'
import Showcase from './landing/components/Showcase'
import WhyPipero from './landing/components/WhyPipero'
import Pricing from './landing/components/Pricing'
import Footer from './landing/components/Footer'

export default function LandingPage() {
    return (
        <div className="lp-page">
            <Header />
            <Hero />
            <SocialProof />
            <Problem />
            <Features />
            <Showcase />
            <WhyPipero />
            <Pricing />
            <Footer />
        </div>
    )
}
