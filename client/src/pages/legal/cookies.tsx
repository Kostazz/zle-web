import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalCookies() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpet na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-cookies-title">Cookies – zasady pouzivani</h1>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Co jsou cookies</h2>
          <p>
            Cookies jsou male textove soubory ukladane ve vasem prohlizeci pri navsteve webu. 
            Pomahaji zajistit zakladni funkce webu a zlepsit uzivatelsky zazitek.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Jake cookies pouzivame</h2>
          <ul className="list-disc list-inside mt-2">
            <li>
              <span className="font-semibold">Nezbytne cookies</span> – nutne pro spravne fungovani webu (nelze je vypnout v nasich systemech).
            </li>
            <li>
              <span className="font-semibold">Analyticke cookies</span> – anonymni statistiky navstevnosti a chovani uzivatelu na webu.
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Jak cookies spravovat</h2>
          <p>
            Pouzivani cookies muzete upravit v nastaveni sveho prohlizece. 
            Muzete je omezit nebo zcela zakazat. V takovem pripade vsak nektere casti webu nemusi fungovat spravne.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">4. Dalsi informace</h2>
          <p>
            Dalsi informace o tom, jak nakladame s udaji, naleznete v dokumentu „Ochrana osobnich udaju (GDPR)".
          </p>
        </section>
      </main>
    </Layout>
  );
}
