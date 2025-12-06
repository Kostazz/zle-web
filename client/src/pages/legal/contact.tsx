import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalContact() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpet na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-legal-contact-title">Legal kontakt – ZLE</h1>

        <p className="mb-4">
          Pro dotazy tykajici se pravnich dokumentu, osobnich udaju nebo reklamaci nas muzete kontaktovat zde:
        </p>

        <p className="mb-4">
          E-mail: ________________________________
        </p>

        <p className="text-neutral-400 text-xs">
          Napis klidne do predmetu „ZLE – pravni dotaz / reklamace", abychom vedeli, ze to ma prioritu.
        </p>
      </main>
    </Layout>
  );
}
