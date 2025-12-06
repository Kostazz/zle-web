import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalTerms() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpet na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-terms-title">Obchodni podminky ZLE</h1>

        <p className="text-neutral-400 mb-4 text-xs">
          Posledni aktualizace: 01.01.2025
        </p>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Provozovatel</h2>
          <p>
            Provozovatel znacky ZLE (dale jen „provozovatel"):
            <br />
            Jmeno / nazev: ________________________________ <br />
            Sidlo: ________________________________ <br />
            ICO (pokud je): ________________________________ <br />
            Kontakt: ________________________________
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Zbozi a sluzby</h2>
          <p>
            ZLE nabizi zejmena obleceni, doplnky a dalsi produkty spojene s underground street kulturou.
            Konkretni popis, vlastnosti a cena jsou vzdy uvedeny u daneho produktu v katalogu nebo v nabidce.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Objednavka a uzavreni smlouvy</h2>
          <p>
            Objednavka vytvorena zakaznikem prostrednictvim webu je navrhem na uzavreni kupni smlouvy.
            Kupni smlouva je uzavrena okamzikem potvrzeni objednavky provozovatelem (napriklad potvrzovacim e-mailem).
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">4. Cena a zpusoby platby</h2>
          <p>
            Cena zbozi je vzdy uvedena u konkretniho produktu. Ceny jsou konecne.
            Prijimane zpusoby platby (dle aktualni nabidky):
          </p>
          <ul className="list-disc list-inside mt-2">
            <li>bankovni prevod</li>
            <li>dobirka / hotove pri osobnim prevzeti</li>
            <li>dalsi metody mohou byt pridany v budoucnu</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">5. Dodani zbozi</h2>
          <p>
            Zbozi je dorucovano prostrednictvim dopravcu (napr. vydejni mista, kuryr) nebo osobnim predanim, pokud je tak domluveno.
            Obvykla doba dodani je 2–7 pracovnich dnu od potvrzeni objednavky / prijeti platby.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">6. Odstoupeni od smlouvy</h2>
          <p>
            Zakaznik – spotrebitel ma pravo odstoupit od smlouvy do 14 dnu od prevzeti zbozi, neni-li stanoveno jinak.
            Pro odstoupeni lze pouzit kontaktni e-mail uvedeny vyse. Zbozi by melo byt vraceno ciste, neposkozene a pokud mozno v puvodnim obalu.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">7. Reklamace a vady</h2>
          <p>
            Podrobny postup pro reklamace je uveden v dokumentu „Reklamacni rad". 
            Zakaznik je povinen zbozi po prevzeti zkontrolovat a pripadne vady oznamit bez zbytecneho odkladu.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">8. Ochrana osobnich udaju</h2>
          <p>
            Zpracovani osobnich udaju se ridi dokumentem „Ochrana osobnich udaju (GDPR)", ktery je dostupny na strance /legal/privacy.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">9. Zaverecna ustanoveni</h2>
          <p>
            Tyto obchodni podminky se ridi pravem Ceske republiky. Provozovatel si vyhrazuje pravo podminky aktualizovat.
            Aktualni zneni je vzdy zverejneno na teto strance.
          </p>
        </section>
      </main>
    </Layout>
  );
}
