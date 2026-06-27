# MajuBiz

**Zero-code agentic commerce for Singapore SMEs** — built at **'Sup BUILD2026**.

Live demo: _(deploy to Railway and paste URL here)_

---

## The pitch

Heartland shop owners restock bubble wrap, carton boxes, and packaging tape every week. They do not write code. They do not have time to refresh Carousell and Shopee listings manually. They still need to pay suppliers on time — with records that reconcile.

**MajuBiz is agentic commerce for heartland SMEs** — autonomous AI agents that search, decide, and pay on the owner's behalf, without code.

It is a no-code dashboard where an SME owner describes what they want in plain English. An agent then monitors the web, finds a deal when conditions are met, and settles payment with structured data — no developer, no spreadsheet, no screenshot of a QR code.

> _"Monitor wholesale prices for bubble wrap and automatically purchase 50 rolls when the price drops below $10."_

That one sentence becomes a live purchasing agent. When the price hits, the agent acts: MajuBiz generates a **PayNow Gen 2–style settlement payload** with invoice line items, reconciliation references, and request-to-pay metadata — the payment rails MAS is building specifically for **agentic commerce**.

---

## Why now — real research

### PayNow is massive; Gen 2 is the upgrade

PayNow has been Singapore's instant payment backbone since 2017. In the **PayNow Generation 2** report released by MAS and the Association of Banks in Singapore on **25 June 2026**, the scale is clear:

| Metric | Value |
|--------|-------|
| Consumer payment value (2025) | **~S$154 billion** |
| Business payment value (2025) | **~S$147 billion** |
| Gen 2 pilot target | **End of 2026** |

Source: [CNA — Singapore looks to upgrade PayNow with reduced payment steps, integration with NETS QR](https://www.channelnewsasia.com/singapore/paynow-nets-qr-code-payments-6210036) (reporting on the MAS/ABS PayNow Generation 2 study)

Deputy PM and MAS Chairman **Gan Kim Yong** said PayNow must evolve as consumer and business needs change. The report identifies four priority enhancements:

1. **PayNow + NETS QR interoperability** — scan and pay at any merchant, regardless of app
2. **Deep-link checkout** — banking app opens with pre-filled payment details (no screenshot step)
3. **Larger-value sandboxed payments** for government agencies (trial from 2027)
4. **Request-to-pay, structured remittance data, cross-border, offline** — payments embedded in software that **reconciles itself**

The same announcement explicitly names the next frontier:

> _"Singapore will also begin laying the groundwork for **agentic commerce** — an emerging form of e-commerce in which autonomous AI agents make their own purchasing decisions independently."_  
> — MAS & ABS joint statement, Jun 2026 ([CNA](https://www.channelnewsasia.com/singapore/paynow-nets-qr-code-payments-6210036))

The report also notes that **businesses require payments embedded directly into their software, with structured data that reconciles itself** — and that gaps remain in merchant-initiated payment requests and B2B functionality. That is exactly the gap MajuBiz demonstrates.

### SMEs are going digital — but need tools they can actually use

Singapore's SME digitalization push (IMDA Digital Enterprise Blueprint, Industry Digital Plans) shows strong adoption — yet many heartland owners still lack developer-friendly tooling:

| Stat | Source |
|------|--------|
| **96.4%** of enterprises adopted at least one digital solution (2025), up from 84.6% (2019) | [MDDI / ATxEnterprise 2026](https://www.mddi.gov.sg/newsroom/address-by-sms-tan-kiat-how-at-the-atxenterprise-2026-opening-ceremony/) |
| **97%** of SMEs adopted sector-specific digital solutions under IMDA Industry Digital Plans (2024) | [IMDA SGDE Report FY2024–2025](https://www.imda.gov.sg/-/media/imda/files/about/resources/corporate-publications/annual-report/imda-sgde-report-fy2024-2025.pdf) |
| **23.5%** enterprise AI adoption (2025), up from 4.3% (2023) — more than 5× in two years | [Singapore Business Review](https://sbr.com.sg/information-technology/news/over-nine-in-10-enterprises-adopt-digital-tools-ai-uptake-surges) |
| **26,000+ SMEs** supported under Digital Enterprise Blueprint since May 2024 | [IMDA](https://www.imda.gov.sg/resources/press-releases-factsheets-and-speeches/press-releases/2025/smes-go-digital-day) |

MajuBiz sits at the intersection: **agentic commerce for non-technical owners**, **local marketplace price discovery**, and **PayNow-native settlement** — aligned with both MAS's agentic commerce roadmap and IMDA's push to help SMEs go digital with confidence.

---

## What MajuBiz does

| Step | What happens | Integration |
|------|----------------|-------------|
| **1. Describe** | Owner types a natural-language rule in **+ New Agent** | — |
| **2. Parse** | Prompt becomes structured rules: product, quantity, price threshold (SGD) | **OpenAI GPT-4o-mini** (structured JSON output) |
| **3. Monitor** | Agent searches live Singapore listings for the best price | **Exa** web search → Shopee, Carousell, Lazada, Qoo10 |
| **4. Settle** | Price below threshold → generate request-to-pay payload with line items + reconciliation ref | **PayNow Gen 2 mock** (settlement JSON; not live banking) |
| **5. Reconcile** | Balance deducts; transaction appears in dashboard with full audit trail | In-memory demo store |

**Demo loop (30 seconds):**

1. Click **+ New Agent** → type a plain-English prompt  
2. **GPT-4o-mini** parses it into structured purchase rules  
3. Click **Run Agent** → **Exa** searches live Shopee/Carousell listings  
4. Price below threshold → **PayNow Gen 2** structured settlement JSON  
5. Balance deducts, transaction appears  

---

## Integrations

### OpenAI — natural language → agent rules

Non-technical owners do not configure JSON. **GPT-4o-mini** with structured outputs turns prompts like _"buy 50 rolls of bubble wrap under $10"_ into machine-readable agent config: product, quantity, unit, and `price_below` trigger in SGD.

Falls back to regex parsing if no API key — demo still works.

### Exa — live price discovery on Singapore marketplaces

**Exa** searches the open web with domain filters for `shopee.sg`, `carousell.sg`, `lazada.sg`, and `qoo10.sg`. It extracts prices from listing titles and highlights — real supplier URLs, real SGD amounts.

Heartland shops already buy and sell on **Carousell** and **Shopee**; Exa bridges those listings into an agent workflow without marketplace APIs.

Falls back to deterministic demo data if no API key.

### PayNow Gen 2 — structured autonomous settlement (mock)

Settlement is **mocked** for the hackathon — no live bank connection — but the payload mirrors what MAS is designing for Gen 2:

- `messageType: REQUEST_TO_PAY`
- Structured remittance: invoice number, line items, `reconciliationRef`
- Agent metadata: trigger reason, scrape provider, agent ID

This is the demo flex: an AI agent that pays with **self-reconciling structured data**, not a human screenshotting a QR into DBS.

---

## Stack

| Layer | Tech |
|-------|------|
| **Frontend** | Vite + React + TypeScript + Tailwind |
| **Backend** | Express + TypeScript |
| **AI parse** | OpenAI GPT-4o-mini |
| **Web search** | Exa (`exa-js`) |
| **Realtime UI** | Server-Sent Events (activity log) |
| **Deploy** | Railway (single Node service) |

---

## Local dev

```bash
npm install
cp server/.env.example server/.env   # add OPENAI_API_KEY + EXA_API_KEY
npm run dev
```

- Dashboard: http://localhost:5173  
- API: http://localhost:3001  

## Production

```bash
npm run build
NODE_ENV=production npm start
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Recommended | ChatGPT API for NL → agent rules |
| `EXA_API_KEY` | Recommended | Exa web search for live price discovery |
| `PORT` | Auto | Railway sets this |
| `NODE_ENV` | Auto | `production` on deploy |

---

## Built for BUILD2026

| Sponsor | Role in MajuBiz |
|---------|------------------|
| **Exa** | Live marketplace price search |
| **OpenAI** | Natural-language agent parsing |
| **Carousell** | Target marketplace (via Exa — no API needed) |
| **IMDA** | SME digitalization narrative |
| **Cursor** | Built with Cursor at BUILD2026 |

**MajuBiz** — _Maju_ means forward/progress in Malay. Zero-code **agentic commerce**: helping Singapore SMEs move from manual restocking to autonomous, PayNow-native purchasing agents.
