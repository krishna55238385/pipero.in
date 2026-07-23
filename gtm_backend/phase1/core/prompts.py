"""All LLM prompts in one place. Edit here, not inside agent code."""

ICP_DEFINITION_SYSTEM = """You extract a structured Ideal Customer Profile (ICP) from a free-text description.
Return ONLY a JSON object matching this schema:
{
  "name": "short name like 'Mid-market SaaS in India'",
  "product_line": "Core" or product line if mentioned,
  "industry": ["array of industry strings"],
  "geography": ["array of city/state/country strings"],
  "company_size_min": int or null (employees),
  "company_size_max": int or null,
  "revenue_range_min": int or null (USD),
  "revenue_range_max": int or null,
  "business_stage": "Seed|Growth|Mature|null",
  "buyer_titles": ["who signs the cheque, e.g. CEO, Founder"],
  "user_titles": ["who uses the product, e.g. Head of HR"],
  "blocker_titles": ["who can stall the deal, e.g. CFO, Procurement"],
  "pain_points": "one-paragraph string"
}
Do not add commentary. Do not wrap in markdown."""

LEAD_NORMALIZATION_SYSTEM = """You extract company records from raw SerpAPI search results.
Given a list of organic results (title, link, snippet), produce a JSON array of companies.

Inclusion rule: Accept a result if its link appears to be a single company's official website
(e.g. acme.com, acme.com/about, acme.com/company) — even when the snippet does not confirm
employee count or geography. Set any unknown fields to null.

CRITICAL — company_name is the organization's BRAND, never the raw page title:
The single most common failure mode is copying a page's literal <title> tag as the
company_name when that title is actually a headline, report name, careers-page label, or
listicle — not the company's brand. Before setting company_name, ask: "is this the actual
name of the organization, or is it describing/ranking/hiring for it?" If it's the latter,
derive the real brand name from the domain instead (e.g. link "careers.zoom.us" with title
"Careers" -> company_name "Zoom"; link "blog.acme.com/some-article" -> company_name "Acme").

Reject/rename (never keep the literal title as company_name) when the title is:
- A careers/jobs page: "Careers", "We're Hiring", "Join Our Team", "Open Positions", any
  job-listing headline (e.g. "Senior Account Executive", "Solutions Engineer, Remote").
- A listicle/ranking: "Top 10 ...", "Best X companies in ...", "8 Best ...", etc.
- A report/study/analysis title: "... Market Research Report 2034", "... Excerpts from
  Presentation", "... Sector Thesis Analysis", "Everest Group ... Sourcing ...", or any
  title naming a THIRD-PARTY analyst/report author rather than the linked company.
  ("49 Not Out! Excerpts from Presentation" is a report, not a company.)
- A news/blog/informational article headline: signals include a question mark
  ("How Many...?", "Is X the New...?"), a leading interrogative/explainer word ("How",
  "Why", "What", "Is", "Does", "Discover why...", "ICP Definition Framework for..."), a
  colon followed by an explanatory clause, " vs " comparisons, or government/informational
  domains (.gov) publishing reports rather than running a company.
- A directory/review/lead-database profile page: g2.com, capterra.com, crunchbase.com,
  clutch.co, wikipedia.org, yelp.com, leadiq.com, or similar — these describe a company,
  they are not the company's own site.

When the title itself is clean but you're unsure of other fields, prefer including with
nulls rather than dropping the row — this rule is ONLY about not reusing a bad title as
company_name, not about rejecting rows outright.

Sources for company_name, in priority order: (1) the snippet's clear naming of the
organization, (2) the domain/brand implied by the link, (3) the page title — ONLY if it
doesn't match any pattern above.

CRITICAL — never cross-attribute fields between different companies in a shared article:
Some results are roundup/launch posts that name SEVERAL companies in one title+snippet
(e.g. "YC W17 Launch: Credy, Upcall and Kangpe", or a post about "Delight AI ... with
Supabase, Vercel and..."). Each such result still produces only ONE company record — the
one whose OWN website the `link` points to. Every field you set (company_city,
company_state, company_country, company_industry, company_size) must describe THAT one
company specifically, evidenced by text about it in particular. Never borrow a location,
size, or industry mentioned about a different company named in the same snippet, even if
it's the only location/size text present — leave the field null instead. A California
address mentioned for "Vercel" in a snippet must never be written onto a "Delight AI"
record just because they appear in the same sentence.

The icp_hint below (industry/geography) is ONLY context for judging which results are
worth including — it is NEVER evidence for a company's actual city/state/country. Do not
let it bias company_country toward the ICP's target geography; a company's location comes
only from text that specifically describes that company, never from the ICP hint.

Return JSON:
{
  "companies": [
    {
      "company_name": "string",
      "company_website": "https://... or null",
      "company_city": "string or null",
      "company_state": "string or null",
      "company_country": "string or null",
      "company_industry": "string or null",
      "company_size": "string or null (e.g. '50-200 employees')",
      "source_url": "the search result link"
    }
  ]
}
Do not invent data. Use null for any field not clearly stated. Do not wrap in markdown."""

COMPANY_ENRICHMENT_SYSTEM = """Extract structured company details from website text, firmographics, and search snippets.

Input JSON: company_name, domain, hunter_metadata ({}=empty), website_text, location_snippets, size_snippets (arrays of {title,link,snippet}, may be empty).

GOAL: fill every field possible. Location and size are the priority gaps.

Priority per field: 1) hunter_metadata  2) website_text/snippets  3) your own knowledge (location, country, industry, size band only).

LOCATION (city/state/country = HQ): always give at least country, city if known. Parse full address or "City, State, Country" into parts.

SIZE (company_size): ALWAYS an employee band, never null unless truly impossible.
Allowed values EXACTLY: "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+".
Map any headcount to a band (e.g. "~120 employees"->"51-200", "5,000 staff"->"1000+", "team of 8"->"1-10").
No stated headcount? Give your best estimate from description/maturity/funding/offices/knowledge — null only if truly impossible.

OTHER: company_address (full HQ address or null), company_phone (or null), company_industry, company_linkedin_url (linkedin.com/company/... or null).

Return ONLY this JSON, no markdown:
{"company_city":"string|null","company_state":"string|null","company_country":"string|null","company_address":"string|null","company_phone":"string|null","company_industry":"string|null","company_size":"band|null","company_size_is_estimate":true|false,"company_linkedin_url":"string|null"}"""

CONTACT_EXTRACTION_SYSTEM = """You extract the best decision-maker contact from LinkedIn search snippets about a company.
Prefer Owner > CEO > Founder > President > VP > Director > Manager. Match the ICP buyer_titles when possible.
Return JSON:
{
  "contact_name": "full name or null",
  "contact_title": "exact title or null",
  "contact_linkedin_url": "url or null"
}
Do not invent data. If unsure, return null for that field. Do not wrap in markdown."""

SIGNAL_QUERY_GENERATION_SYSTEM = """You generate Google search queries to discover buying-signal candidates for a specific target company.

Input (JSON):
  {"company_name", "company_industry", "company_country", "buyer_titles"}

Output (JSON) — return EXACTLY:
  {"queries": [{"engine": "...", "q": "...", "signal_focus": "...", "num": int}, ...]}

Field rules:
- engine: "google_news" for press/news; "google" for web pages (careers, G2, reviews, listings)
- signal_focus: one of [funding, leadership_change, hiring, expansion, competitor_complaint, news]
- num: integer 3-5 (how many results to pull for this query)

Generate 5-7 queries that COLLECTIVELY cover all signal types. Tailor wording to the industry — e.g. for HR-tech, use "ATS", "recruiter", "talent"; for fintech, "RBI", "regulatory"; for healthcare, "FDA", "clinical".

Use OR operators to broaden a single query when helpful. Avoid duplicate queries.

Example (HR-tech in India, company "Acme HR"):
{
  "queries": [
    {"engine": "google_news", "q": "Acme HR", "signal_focus": "news", "num": 5},
    {"engine": "google_news", "q": "\\"Acme HR\\" Series A OR seed funding OR raised", "signal_focus": "funding", "num": 4},
    {"engine": "google_news", "q": "\\"Acme HR\\" new CEO OR appointed OR joined OR hired", "signal_focus": "leadership_change", "num": 3},
    {"engine": "google", "q": "\\"Acme HR\\" hiring careers jobs", "signal_focus": "hiring", "num": 3},
    {"engine": "google_news", "q": "\\"Acme HR\\" expansion OR new office OR acquisition", "signal_focus": "expansion", "num": 3},
    {"engine": "google", "q": "\\"Acme HR\\" G2 OR trustradius reviews", "signal_focus": "competitor_complaint", "num": 3}
  ]
}

Do not invent. Do not wrap in markdown. Return ONLY the JSON object."""

SIGNAL_CLASSIFICATION_SYSTEM = """You analyze a batch of signal candidates for a company and classify each as a buying signal.

Input (JSON):
  {
    "company_name": "...",
    "candidates": [
      {"id": 0, "signal_text": "raw headline/snippet/job post", "source": "url"},
      ...
    ]
  }

Output (JSON) — return EXACTLY this shape (one entry per candidate, same order):
  {
    "results": [
      {"id": 0, "signal_type": "...", "buying_intent": "high" | "low" | "na"},
      ...
    ]
  }

signal_type must be one of:
  - funding (raised seed/Series A/B/C/etc)
  - leadership_change (new CEO/CFO/CTO/CMO, exec hired, exec exit)
  - hiring (active job postings, growing team, "we're hiring")
  - expansion (new office, market entry, acquisition)
  - competitor_complaint (public dissatisfaction with a competitor — opens the door)
  - none (not a buying-relevant event)

buying_intent rubric:
  - high  : strong, fresh, decision-trigger event (e.g. just-closed funding, new CRO joining,
            aggressive hiring push, M&A, explicit competitor pain)
  - low   : weak/old/peripheral signal of the same type
  - na    : not a buying signal at all (puff piece, generic news, unrelated press)

If signal_type is "none", buying_intent MUST be "na".
Classify every candidate — never skip any. Do not invent. Do not wrap in markdown. Return ONLY the JSON object."""

SOCIAL_LISTENING_QUERY_GENERATION_SYSTEM = """You generate search queries to find PEOPLE or COMPANIES publicly signalling
they need a product like this, on public forums/social platforms — NOT queries about any specific
already-known company.

Input (JSON): {"industry": [...], "pain_points": "...", "geography": [...], "buyer_titles": [...]}

Output (JSON) — return EXACTLY:
  {"queries": [{"q": "...", "pain_point_focus": "..."}, ...]}

Generate 5-7 queries that search public discussion for people expressing the ICP's pain points as a
live problem right now — complaints, "looking for a tool that...", "does anyone use X for Y",
"frustrated with our current...", "switching from...". Use site: restriction to target public forums
likely to be indexed by Google: site:reddit.com, site:news.ycombinator.com, or no site restriction for
general web/news coverage. Do NOT search for a specific company by name — this agent discovers NEW
people/companies, it does not investigate known ones (that is Agent 04's job).

Example (HR-tech in India, pain_points "manual payroll compliance is error-prone and slow"):
{
  "queries": [
    {"q": "site:reddit.com payroll compliance India frustrated OR nightmare OR manual", "pain_point_focus": "manual payroll compliance"},
    {"q": "\\"looking for\\" HR software India recommendation reddit", "pain_point_focus": "seeking alternative"},
    {"q": "switching from Excel payroll India startup", "pain_point_focus": "outgrowing spreadsheets"},
    {"q": "site:news.ycombinator.com HR tech India hiring pain", "pain_point_focus": "general pain"},
    {"q": "HR compliance India \\"any recommendations\\"", "pain_point_focus": "seeking alternative"}
  ]
}

Do not invent. Do not wrap in markdown. Return ONLY the JSON object."""

SOCIAL_LISTENING_CLASSIFICATION_SYSTEM = """You review public search-result snippets and decide which ones are a REAL
PERSON OR COMPANY publicly signalling active need for a product matching the given ICP — not news
articles, not vendor marketing, not unrelated discussion.

Input (JSON):
  {
    "icp_summary": "industry / pain points / buyer titles",
    "candidates": [{"id": 0, "text": "title — snippet", "source": "url"}, ...]
  }

Output (JSON) — return EXACTLY this shape (one entry per candidate, same order):
  {
    "results": [
      {
        "id": 0,
        "is_signal": true|false,
        "candidate_company": "string or null (only if a specific company is identifiable)",
        "candidate_person": "string or null (only if a specific person is identifiable, e.g. a Reddit
                              username or named author — never invent a name)",
        "candidate_title": "string or null",
        "matched_pain_point": "which ICP pain point this matches, or null",
        "confidence": "high" | "medium" | "low"
      },
      ...
    ]
  }

is_signal=true ONLY when the text is someone describing their OWN active problem or need right now,
matching the ICP's pain points/industry — not a listicle, not a news report about the market, not a
vendor's own marketing copy, not a generic discussion with no expressed need.

confidence:
  - high   : explicit, specific, recent-sounding need ("we're switching from X because...")
  - medium : plausible need but vague or old-sounding
  - low    : weak/ambiguous match, include only if nothing better

Never invent a company or person name that is not evidenced in the text — null is correct when
unknown. Classify every candidate. Do not wrap in markdown. Return ONLY the JSON object."""

ICP_SCORING_SYSTEM = """You are a B2B sales qualification expert. Score a lead out of 100.

Input JSON keys:
  - "icp": Ideal Customer Profile (industry, geography, size range, buyer_titles, business_stage)
  - "lead": key company/contact fields only (company_name, country, industry, size, contact_title)
  - "signals": compact buying-signal summary with keys:
      "total" (int), "high_intent" (list of signal types), "low_intent" (list of signal types)
  - "deterministic_score": 0-100 rule-based baseline

Return ONLY this JSON:
{
  "llm_icp_score": <int 0-100>,
  "llm_score_tier": "hot" | "warm" | "cold" | "disqualified",
  "llm_reasoning": "<2-3 sentence explanation>",
  "buying_intent_summary": "<1 sentence summary of buying signals>"
}

Scoring rules:
- hot >= 80, warm >= 50, cold < 50; disqualified only if completely off-profile
- Weight: industry fit > geography fit > buyer title match > company size fit
- Each high_intent signal type (funding, leadership_change, expansion) adds ~8-10 pts; low_intent adds ~3 pts
- Use deterministic_score as baseline; adjust by ±15 based on ICP fit judgment
- Sparse lead data (missing country, size, title) caps score at 65

No markdown. Return ONLY the JSON object."""
