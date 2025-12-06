import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalPrivacy() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpet na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-privacy-title">Ochrana osobnich udaju (GDPR)</h1>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Spravce osobnich udaju</h2>
          <p>
            Spravcem osobnich udaju je:
            <br />
            Jmeno / nazev: ________________________________ <br />
            Kontakt (e-mail): ________________________________
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Rozsah zpracovavanych udaju</h2>
          <p>Zpracovavame zejmena tyto kategorie udaju:</p>
          <ul className="list-disc list-inside mt-2">
            <li>identifikacni udaje (jmeno, prijmeni)</li>
            <li>kontaktni udaje (e-mail, telefon, dorucovaci adresa)</li>
            <li>udaje o objednavkach a platbach</li>
            <li>technicke udaje z cookies (IP adresa, typ zarizeni, zakladni analytika)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Ucely zpracovani</h2>
          <p>Osobni udaje zpracovavame za ucelem:</p>
          <ul className="list-disc list-inside mt-2">
            <li>vyrizeni objednavek a doruceni zbozi</li>
            <li>komunikace se zakazniky (dotazy, podpora, reklamace)</li>
            <li>plneni pravnich povinnosti (danove, ucetni predpisy)</li>
            <li>zakladni analytiky a ochrany webu (opravneny zajem)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">4. Pravni zaklad zpracovani</h2>
          <p>
            Zpracovani osobnich udaju probiha na zaklade:
          </p>
          <ul className="list-disc list-inside mt-2">
            <li>plneni smlouvy (objednavka zbozi)</li>
            <li>splneni pravni povinnosti (vedeni ucetnictvi apod.)</li>
            <li>opravneneho zajmu spravce (bezpecnost, analytika)</li>
            <li>souhlasu subjektu udaju (napr. newsletter – pokud bude pouzit)</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">5. Doba uchovani udaju</h2>
          <p>
            Udaje uchovavame po dobu nezbytnou k plneni uvedenych ucelu a v souladu s pravnimi predpisy (napr. ucetni doklady po dobu stanovenou zakonem).
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">6. Prijemci osobnich udaju</h2>
          <p>Osobni udaje mohou byt zpristupneny:</p>
          <ul className="list-disc list-inside mt-2">
            <li>dopravcum (pro doruceni zbozi)</li>
            <li>poskytovateli webhostingu / technickeho reseni</li>
            <li>pripadne ucetnimu nebo danovemu poradci</li>
          </ul>
          <p className="mt-2">
            Vzdy pouze v nezbytnem rozsahu pro splneni daneho ucelu.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">7. Prava subjektu udaju</h2>
          <p>Mate zejmena tato prava:</p>
          <ul className="list-disc list-inside mt-2">
            <li>pravo na pristup k osobnim udajum</li>
            <li>pravo na opravu nebo doplneni udaju</li>
            <li>pravo na vymaz (pokud to nebrani zakonnym povinnostem)</li>
            <li>pravo na omezeni zpracovani</li>
            <li>pravo vznest namitku proti zpracovani</li>
            <li>pravo podat stiznost u Uradu pro ochranu osobnich udaju</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">8. Kontakt pro GDPR</h2>
          <p>
            Pro uplatneni prav nebo dotazy k ochrane osobnich udaju nas kontaktujte na:
            <br />
            E-mail: ________________________________
          </p>
        </section>
      </main>
    </Layout>
  );
}
