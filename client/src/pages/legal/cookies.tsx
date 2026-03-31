import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { ArrowLeft } from "lucide-react";

export default function LegalCookies() {
  return (
    <Layout>
      <main className="max-w-2xl mx-auto pt-20 pb-32 px-4 text-neutral-200 text-sm leading-relaxed">
        <Link href="/legal" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8 transition-colors" data-testid="link-back-legal">
          <ArrowLeft className="h-4 w-4" />
          Zpět na Legal
        </Link>
        
        <h1 className="text-3xl font-bold mb-6" data-testid="text-cookies-title">Cookies – zásady používání</h1>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">1. Co jsou cookies</h2>
          <p>
            Cookies a obdobná lokální úložiště jsou malé soubory ukládané ve vašem zařízení při
            návštěvě webu. Slouží hlavně k zajištění základních technických funkcí.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Jaké cookies používáme</h2>
          <ul className="list-disc list-inside mt-2">
            <li>
              <span className="font-semibold">Nezbytné technické cookies / lokální úložiště</span> – nutné
              pro správné fungování webu a bezpečný provoz služby.
            </li>
          </ul>
          <p className="mt-3">
            Analytické a marketingové cookies aktuálně nejsou aktivní.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Budoucí změny</h2>
          <p>
            Pokud v budoucnu nasadíme analytické nebo marketingové nástroje, bude to až po zavedení
            odpovídající souhlasové vrstvy.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">4. Jak technická cookies omezit</h2>
          <p>
            Nastavení cookies můžete upravit ve svém prohlížeči. Omezení nezbytných cookies může
            ovlivnit funkčnost některých částí webu.
          </p>
          <p className="mt-2">
            Další informace o zpracování údajů najdete v dokumentu „Ochrana osobních údajů (GDPR)".
          </p>
        </section>
      </main>
    </Layout>
  );
}
