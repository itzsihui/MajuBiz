import { ArrowRight, Bot, Shield, Sparkles, Wallet, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { BackgroundBeamsWithCollision } from "../components/ui/BackgroundBeamsWithCollision";
import { TextFlippingBoard } from "../components/ui/TextFlippingBoard";

const FLAP_PHRASES = [
  "BUBBLE WRAP",
  "AUTO RESTOCK",
  "PAYNOW GEN2",
  "SELLER AGENT",
  "SINGAPORE SME",
];

const STEPS = [
  { n: "01", title: "Describe", body: "Type a plain-English rule — no code, no JSON." },
  { n: "02", title: "Discover", body: "Exa searches live listings; seller agents return structured quotes." },
  { n: "03", title: "Approve", body: "Agent Brain picks the best deal — you confirm before payment." },
  { n: "04", title: "Settle", body: "PayNow Gen 2-style payload with invoice line items and refs." },
];

const FEATURES = [
  {
    icon: Sparkles,
    title: "Plain English agents",
    body: "Describe what to buy in one sentence. GPT-4o-mini turns it into purchase rules — no code.",
  },
  {
    icon: Zap,
    title: "Exa + Seller Agent",
    body: "Live web search first, then structured seller-agent quotes when marketplaces aren't agent-ready.",
  },
  {
    icon: Bot,
    title: "Human in the loop",
    body: "Agent Brain picks the best deal — you approve before PayNow settlement fires.",
  },
  {
    icon: Wallet,
    title: "PayNow Gen 2 mock",
    body: "Structured request-to-pay JSON with invoice line items and reconciliation refs — MAS-ready narrative.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">BUILD2026</div>
          </div>
          <Link
            to="/app"
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            View Demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <BackgroundBeamsWithCollision className="min-h-[88vh] pt-24 pb-20 md:min-h-[92vh]">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Agentic commerce for Singapore heartland SMEs
          </p>

          <h1 className="mx-auto max-w-4xl text-center text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            <span className="block">Your shop restocks itself.</span>
            <span className="mt-1 block bg-gradient-to-r from-amber-200 via-brand-300 to-violet-300 bg-clip-text text-transparent">
              You stay in control.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-center text-lg text-slate-400">
            Zero-code AI agents search Shopee & Carousell, negotiate via seller APIs, and settle with PayNow Gen
            2-style structured payments.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-500"
            >
              Open live demo
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-slate-300 transition hover:border-white/30 hover:text-white"
            >
              See how it works
            </a>
          </div>

          <div className="mt-14 flex justify-center">
            <TextFlippingBoard phrases={FLAP_PHRASES} intervalSec={2.8} />
          </div>
        </div>
      </BackgroundBeamsWithCollision>

      <section id="how-it-works" className="border-t border-white/5 bg-slate-900/40 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">
            From plain English to PayNow settlement — four steps, zero code.
          </p>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="relative rounded-2xl border border-white/10 bg-slate-950/80 p-6 transition hover:border-brand-500/40"
              >
                <span className="text-3xl font-bold text-brand-500/30">{step.n}</span>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/5 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold">Built for the agentic commerce era</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
            MAS is laying groundwork for autonomous purchasing. MajuBiz shows what that looks like for a Tampines
            packaging shop — today.
          </p>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 transition hover:border-brand-500/30 hover:bg-slate-900"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              Try the demo now
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5 py-10 text-center text-sm text-slate-500">
        <p>MajuBiz MVP · Built for Singapore SMEs at BUILD2026</p>
        <p className="mt-1 text-xs text-slate-600">
          UI inspired by{" "}
          <a
            href="https://ui.aceternity.com/components/background-beams-with-collision"
            className="text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Aceternity UI
          </a>
        </p>
      </footer>
    </div>
  );
}
