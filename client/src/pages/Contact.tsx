import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Mail, Instagram, ExternalLink } from "lucide-react";

export default function Contact() {
  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <div className="mb-12 md:mb-16">
              <h1 
                className="font-display text-4xl md:text-6xl text-white tracking-tight mb-4 opacity-0 animate-fade-in zle-text-3d"
                data-testid="text-contact-title"
              >
                KONTAKT
              </h1>
              <p className="font-sans text-lg text-white/60 opacity-0 animate-fade-in" style={{ animationDelay: "0.1s" }}>
                Máš dotaz? Napiš nám. Odpovídáme všem.
              </p>
            </div>

            <div className="space-y-8 opacity-0 animate-fade-in" style={{ animationDelay: "0.2s" }}>
              <div className="p-6 md:p-8 zle-content-block">
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6 zle-text-3d-subtle">
                  SPOJENÍ
                </h2>
                
                <div className="space-y-4">
                  <a
                    href="mailto:info@zleskate.cz"
                    className="flex items-center gap-4 text-white/80 hover:text-white transition-colors group"
                    data-testid="link-contact-email"
                  >
                    <div className="w-12 h-12 border border-white/30 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors rounded-sm">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="font-heading text-xs text-white/50 block">EMAIL</span>
                      <span className="font-sans">info@zleskate.cz</span>
                    </div>
                  </a>

                  <a
                    href="https://instagram.com/zle.skate"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 text-white/80 hover:text-white transition-colors group"
                    data-testid="link-contact-instagram"
                  >
                    <div className="w-12 h-12 border border-white/30 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors rounded-sm">
                      <Instagram className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="font-heading text-xs text-white/50 block">INSTAGRAM</span>
                      <span className="font-sans">@zle.skate</span>
                    </div>
                  </a>
                </div>
              </div>

              <div className="p-6 md:p-8 zle-content-block">
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6 zle-text-3d-subtle">
                  PRODEJNÍ MÍSTA
                </h2>
                
                <a
                  href="https://totalboardshop.cz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 text-white/80 hover:text-white transition-colors group"
                  data-testid="link-contact-totalboardshop"
                >
                  <div className="w-12 h-12 border border-white/30 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors rounded-sm">
                    <ExternalLink className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-heading text-xs text-white/50 block">PARTNERSHOP</span>
                    <span className="font-sans">TotalBoardShop.cz</span>
                  </div>
                </a>
              </div>

              <div className="p-6 md:p-8 zle-content-block">
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6 zle-text-3d-subtle">
                  PRO OBCHODNÍ SPOLUPRÁCI
                </h2>
                
                <p className="font-sans text-white/70 text-sm leading-relaxed mb-4">
                  Máš skateshop nebo obchod a chceš prodávat ZLE? Ozvi se nám na email 
                  a domluvíme podmínky.
                </p>
                
                <Button
                  asChild
                  variant="outline"
                  className="font-heading text-sm tracking-wider border-white/30 text-white hover:bg-white hover:text-black zle-button-3d"
                >
                  <a href="mailto:business@zleskate.cz" data-testid="button-business-email">
                    NAPSAT BUSINESS EMAIL
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
