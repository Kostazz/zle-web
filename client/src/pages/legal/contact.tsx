import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";
import { legalConfig } from "@/config/legal";

export default function LegalContact() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpět na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-legal-contact-title">Legal kontakt – ZLE</h1>

        <p className="mb-4">
          Pro dotazy týkající se právních dokumentů, osobních údajů nebo reklamací nás můžete kontaktovat zde:
        </p>

        <p className="mb-4">
          Provozovatel: {legalConfig.operatorName}
          <br />
          IČO: {legalConfig.companyId}
          <br />
          Sídlo: {legalConfig.operatorAddress}
          <br />
          E-mail: {legalConfig.contactEmail}
        </p>

        <p className="text-neutral-400 text-xs">
          Napiš klidně do předmětu „ZLE – právní dotaz / reklamace", abychom věděli, že to má prioritu.
        </p>

        <div className="mt-6 text-sm text-neutral-300 space-y-2">
          <p>
            Reklamace:{" "}
            <Link href="/legal/returns" className="underline underline-offset-4 hover:text-white">
              /legal/returns
            </Link>
          </p>
          <p>
            Odstoupení od smlouvy:{" "}
            <Link href="/legal/withdrawal" className="underline underline-offset-4 hover:text-white">
              /legal/withdrawal
            </Link>
          </p>
          <p>
            Ochrana osobních údajů:{" "}
            <Link href="/legal/privacy" className="underline underline-offset-4 hover:text-white">
              /legal/privacy
            </Link>
          </p>
        </div>
      </main>
    </Layout>
  );
}
