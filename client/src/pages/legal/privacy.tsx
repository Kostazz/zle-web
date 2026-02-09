import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";
import { legalConfig } from "@/config/legal";

export default function LegalPrivacy() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link
          href="/legal"
          className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors"
          data-testid="link-back-legal"
        >
          <ArrowLeft className="h-4 w-4" />
          Zpět na Legal
        </Link>

        <h1 className="text-3xl font-bold mb-6" data-testid="text-privacy-title">
          Ochrana osobních údajů (GDPR)
        </h1>

        {legalConfig.warning ? (
          <div className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100 text-xs">
            {legalConfig.warning}
          </div>
        ) : null}

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Správce osobních údajů</h2>
          <p>
            Správcem osobních údajů je:
            <br />
            Jméno / název: {legalConfig.operatorName}
            <br />
            Sídlo: {legalConfig.operatorAddress}
            <br />
            Kontakt (e-mail): {legalConfig.contactEmail}
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Rozsah zpracovávaných údajů</h2>
          <p>Zpracováváme zejména tyto kategorie údajů:</p>
          <ul className="list-disc list-inside mt-2">
            <li>identifikační údaje (jméno, příjmení)</li>
            <li>kontaktní údaje (e-mail, telefon, doručovací adresa)</li>
            <li>údaje o objednávkách a platbách</li>
            <li>technické údaje z cookies (IP adresa, typ zařízení, základní analytika)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Účely zpracování</h2>
          <p>Osobní údaje zpracováváme za účelem:</p>
          <ul className="list-disc list-inside mt-2">
            <li>vyřízení objednávek a doručení zboží</li>
            <li>komunikace se zákazníky (dotazy, podpora, reklamace)</li>
            <li>plnění právních povinností (daňové, účetní předpisy)</li>
            <li>základní analytiky a ochrany webu (oprávněný zájem)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">4. Právní základ zpracování</h2>
          <p>Zpracování osobních údajů probíhá na základě:</p>
          <ul className="list-disc list-inside mt-2">
            <li>plnění smlouvy (objednávka zboží)</li>
            <li>splnění právní povinnosti (vedení účetnictví apod.)</li>
            <li>oprávněného zájmu správce (bezpečnost, analytika)</li>
            <li>souhlasu subjektu údajů (např. newsletter – pokud bude použit)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">5. Doba uchování údajů</h2>
          <p>
            Údaje uchováváme po dobu nezbytnou k plnění uvedených účelů a v souladu s právními
            předpisy (např. účetní doklady po dobu stanovenou zákonem).
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">6. Příjemci osobních údajů</h2>
          <p>Osobní údaje mohou být zpřístupněny:</p>
          <ul className="list-disc list-inside mt-2">
            <li>dopravcům (pro doručení zboží)</li>
            <li>poskytovateli webhostingu / technického řešení</li>
            <li>případně účetnímu nebo daňovému poradci</li>
          </ul>
          <p className="mt-2">Vždy pouze v nezbytném rozsahu pro splnění daného účelu.</p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">7. Práva subjektů údajů</h2>
          <p>Máte zejména tato práva:</p>
          <ul className="list-disc list-inside mt-2">
            <li>právo na přístup k osobním údajům</li>
            <li>právo na opravu nebo doplnění údajů</li>
            <li>právo na výmaz (pokud to nebrání zákonným povinnostem)</li>
            <li>právo na omezení zpracování</li>
            <li>právo vznést námitku proti zpracování</li>
            <li>právo podat stížnost u Úřadu pro ochranu osobních údajů</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">8. Kontakt pro GDPR</h2>
          <p>
            Pro uplatnění práv nebo dotazy k ochraně osobních údajů nás kontaktujte na:
            <br />
            E-mail: {legalConfig.contactEmail}
          </p>
        </section>
      </main>
    </Layout>
  );
}
