import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";
import { legalConfig } from "@/config/legal";

export default function LegalWithdrawal() {
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

        <h1 className="text-3xl font-bold mb-6" data-testid="text-withdrawal-title">
          Odstoupení od smlouvy
        </h1>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Právo odstoupit do 14 dnů</h2>
          <p>
            Pokud jsi spotřebitel, máš právo odstoupit od kupní smlouvy do 14 dnů od převzetí zboží,
            a to bez udání důvodu.
          </p>
          <p className="mt-2">Toto právo se vztahuje pouze na zákazníky v postavení spotřebitele.</p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Jak odstoupit – krok za krokem</h2>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>Pošli nám oznámení o odstoupení na e-mail {legalConfig.contactEmail}.</li>
            <li>Uveď identifikaci objednávky (např. číslo objednávky, jméno, e-mail).</li>
            <li>Zboží pečlivě zabal a odešli zpět bez zbytečného odkladu.</li>
            <li>Po převzetí zboží (nebo dokladu o odeslání) vrátíme peníze dle zákonné lhůty.</li>
          </ol>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Důležité informace k vrácení</h2>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Náklady na vrácení zboží hradí zákazník.</li>
            <li>Vracené zboží by mělo být čisté a přiměřeně nepoškozené.</li>
            <li>
              Zákazník odpovídá za snížení hodnoty zboží, pokud s ním nakládal jinak, než je nutné
              k seznámení se s jeho povahou, vlastnostmi a funkčností.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">4. Vzorový formulář odstoupení od smlouvy</h2>
          <pre className="mt-2 rounded-md border border-white/15 bg-white/5 p-4 text-xs text-neutral-200 whitespace-pre-wrap font-sans">
{`Adresát: ${legalConfig.operatorName}, ${legalConfig.operatorAddress}, e-mail: ${legalConfig.contactEmail}

Oznamuji, že tímto odstupuji od smlouvy o koupi tohoto zboží:

Číslo objednávky:
Datum objednání:
Datum převzetí:
Jméno a příjmení spotřebitele:
Adresa spotřebitele:
E-mail spotřebitele:

Datum:
Podpis spotřebitele (pouze pokud je formulář zasílán v listinné podobě):`}
          </pre>
        </section>
      </main>
    </Layout>
  );
}
