import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Magnivo AI — Pipeline, Simplified. | AI-Powered CRM for SMB Sales Teams",
    description:
        "Magnivo AI helps growing sales teams track deals, automate follow-ups, and close faster — without the chaos. The CRM built for speed.",
    keywords: [
        "CRM",
        "sales CRM",
        "AI CRM",
        "small business CRM",
        "pipeline management",
        "sales automation",
        "deal tracking",
    ],
    openGraph: {
        title: "Magnivo AI — Pipeline, Simplified.",
        description:
            "The AI-powered CRM that removes friction from your sales pipeline. Fast, intuitive, and automation-first.",
        type: "website",
        url: "https://pipero.io",
        siteName: "Magnivo AI",
    },
    twitter: {
        card: "summary_large_image",
        title: "Magnivo AI — Pipeline, Simplified.",
        description:
            "The AI-powered CRM that removes friction from your sales pipeline.",
    },
    robots: "index, follow",
};

export default function LandingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
