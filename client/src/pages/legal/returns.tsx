import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalReturns() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpět na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-returns-title">Reklamační řád ZLE</h1>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Uplatnění reklamace</h2>
          <p>
            Reklamaci zboží zakoupeného u ZLE lze uplatnit bez zbytečného odkladu po zjištění vady.
            Pro co nejrychlejší vyřízení doporučujeme postupovat následovně.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Kontakt pro reklamace</h2>
          <p>
            {/* TODO: doplň e-mail */}
            Reklamaci můžete uplatnit e-mailem na adrese: ________________________________ <br />
            Do zprávy prosím uveďte:
          </p>
          <ul className="list-disc list-inside mt-2">
            <li>jméno a kontakt</li>
            <li>číslo objednávky</li>
            <li>popis závady</li>
            <li>fotografie vady (pokud je to možné)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Lhůta pro vyřízení</h2>
          <p>
            Reklamace bude vyřízena bez zbytečného odkladu, nejpozději do 30 dnů od jejího uplatnění, pokud se nedohodneme jinak.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">4. Způsob vyřízení reklamace</h2>
          <p>V závislosti na charakteru vady může být reklamace vyřízena například:</p>
          <ul className="list-disc list-inside mt-2">
            <li>opravou zboží</li>
            <li>výměnou za nové zboží</li>
            <li>přiměřenou slevou z kupní ceny</li>
            <li>vrácením kupní ceny</li>
          </ul>
        </section>
      </main>
    </Layout>
  );
}
