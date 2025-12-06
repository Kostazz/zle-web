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
            Cookies jsou malé textové soubory ukládané ve vašem prohlížeči při návštěvě webu. 
            Pomáhají zajistit základní funkce webu a zlepšit uživatelský zážitek.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">2. Jaké cookies používáme</h2>
          <ul className="list-disc list-inside mt-2">
            <li>
              <span className="font-semibold">Nezbytné cookies</span> – nutné pro správné fungování webu (nelze je vypnout v našich systémech).
            </li>
            <li>
              <span className="font-semibold">Analytické cookies</span> – anonymní statistiky návštěvnosti a chování uživatelů na webu.
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="font-semibold mb-2">3. Jak cookies spravovat</h2>
          <p>
            Používání cookies můžete upravit v nastavení svého prohlížeče. 
            Můžete je omezit nebo zcela zakázat. V takovém případě však některé části webu nemusí fungovat správně.
          </p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">4. Další informace</h2>
          <p>
            Další informace o tom, jak nakládáme s údaji, naleznete v dokumentu „Ochrana osobních údajů (GDPR)".
          </p>
        </section>
      </main>
    </Layout>
  );
}
