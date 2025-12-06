import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalHub() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200">
        <Link href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-home">
          <ArrowLeft className="h-4 w-4" />
          Zpět
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-legal-title">ZLE Legal Hub</h1>

        <p className="mb-6 text-neutral-400 text-sm leading-relaxed">
          Kompletní právní dokumentace značky ZLE. Všechno přehledně, nerušivě a profesionálně na jednom místě.
        </p>

        <ul className="space-y-3 text-sm text-neutral-300">
          <li>
            <Link href="/legal/terms" className="hover:text-white underline underline-offset-4" data-testid="link-legal-terms">
              Obchodní podmínky
            </Link>
          </li>
          <li>
            <Link href="/legal/privacy" className="hover:text-white underline underline-offset-4" data-testid="link-legal-privacy">
              Ochrana osobních údajů (GDPR)
            </Link>
          </li>
          <li>
            <Link href="/legal/cookies" className="hover:text-white underline underline-offset-4" data-testid="link-legal-cookies">
              Cookies
            </Link>
          </li>
          <li>
            <Link href="/legal/returns" className="hover:text-white underline underline-offset-4" data-testid="link-legal-returns">
              Reklamační řád
            </Link>
          </li>
          <li>
            <Link href="/legal/contact" className="hover:text-white underline underline-offset-4" data-testid="link-legal-contact">
              Kontakt pro právní dotazy
            </Link>
          </li>
        </ul>
      </main>
    </Layout>
  );
}
