import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalReturns() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpet na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-returns-title">Reklamacni rad ZLE</h1>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Uplatneni reklamace</h2>
          <p>
            Reklamaci zbozi zakoupeneho u ZLE lze uplatnit bez zbytecneho odkladu po zjisteni vady.
            Pro co nejrychlejsi vyrizeni doporucujeme postupovat nasledovne.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Kontakt pro reklamace</h2>
          <p>
            Reklamaci muzete uplatnit e-mailem na adrese: ________________________________ <br />
            Do zpravy prosim uvedte:
          </p>
          <ul className="list-disc list-inside mt-2">
            <li>jmeno a kontakt</li>
            <li>cislo objednavky</li>
            <li>popis zavady</li>
            <li>fotografie vady (pokud je to mozne)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Lhuta pro vyrizeni</h2>
          <p>
            Reklamace bude vyrizena bez zbytecneho odkladu, nejpozdeji do 30 dnu od jejiho uplatneni, pokud se nedohodneme jinak.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">4. Zpusob vyrizeni reklamace</h2>
          <p>V zavislosti na charakteru vady muze byt reklamace vyrizena napriklad:</p>
          <ul className="list-disc list-inside mt-2">
            <li>opravou zbozi</li>
            <li>vymenou za nove zbozi</li>
            <li>primerenou slevou z kupni ceny</li>
            <li>vracenim kupni ceny</li>
          </ul>
        </section>
      </main>
    </Layout>
  );
}
