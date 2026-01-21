import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalTerms() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpět na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-terms-title">Obchodní podmínky ZLE</h1>

        <p className="text-neutral-400 mb-4 text-xs">
          Poslední aktualizace: {/* TODO: doplň datum, např. 01.01.2025 */}
        </p>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Provozovatel</h2>
          <p>
            Provozovatel značky ZLE (dále jen „provozovatel"):
            <br />
            {/* TODO: doplň svoje údaje */}
            Jméno / název: ________________________________ <br />
            Sídlo: ________________________________ <br />
            IČO (pokud je): ________________________________ <br />
            Kontakt: ________________________________
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Zboží a služby</h2>
          <p>
            ZLE nabízí zejména oblečení, doplňky a další produkty spojené s underground street kulturou.
            Konkrétní popis, vlastnosti a cena jsou vždy uvedeny u daného produktu v katalogu nebo v nabídce.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Objednávka a uzavření smlouvy</h2>
          <p>
            Objednávka vytvořená zákazníkem prostřednictvím webu je návrhem na uzavření kupní smlouvy.
            Kupní smlouva je uzavřena okamžikem potvrzení objednávky provozovatelem (například potvrzovacím e-mailem).
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">4. Cena a způsoby platby</h2>
          <p>
            Cena zboží je vždy uvedena u konkrétního produktu. Ceny jsou konečné.
            Přijímané způsoby platby (dle aktuální nabídky):
          </p>
          <ul className="list-disc list-inside mt-2">
            <li>bankovní převod</li>
            <li>dobírka / hotově při osobním převzetí</li>
            <li>další metody mohou být přidány v budoucnu</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">5. Dodání zboží</h2>
          <p>
            Zboží je doručováno prostřednictvím dopravců (např. výdejní místa, kurýr) nebo osobním předáním, pokud je tak domluveno.
            Obvyklá doba dodání je 2–7 pracovních dnů od potvrzení objednávky / přijetí platby.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">6. Odstoupení od smlouvy</h2>
          <p>
            Zákazník – spotřebitel má právo odstoupit od smlouvy do 14 dnů od převzetí zboží, není-li stanoveno jinak.
            Pro odstoupení lze použít kontaktní e-mail uvedený výše. Zboží by mělo být vráceno čisté, nepoškozené a pokud možno v původním obalu.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">7. Reklamace a vady</h2>
          <p>
            Podrobný postup pro reklamace je uveden v dokumentu „Reklamační řád". 
            Zákazník je povinen zboží po převzetí zkontrolovat a případné vady oznámit bez zbytečného odkladu.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">8. Ochrana osobních údajů</h2>
          <p>
            Zpracování osobních údajů se řídí dokumentem „Ochrana osobních údajů (GDPR)", který je dostupný na stránce /legal/privacy.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">9. Závěrečná ustanovení</h2>
          <p>
            Tyto obchodní podmínky se řídí právem České republiky. Provozovatel si vyhrazuje právo podmínky aktualizovat.
            Aktuální znění je vždy zveřejněno na této stránce.
          </p>
        </section>
      </main>
    </Layout>
  );
}
