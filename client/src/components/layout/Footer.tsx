import { Link } from "wouter";
import { Instagram, Mail, ExternalLink } from "lucide-react";
import { ZleLogo } from "@/components/ZleLogo";

export function Footer() {
  return (
    <footer className="bg-black border-t border-white/10 py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          <div>
            {/* BIG LOGO (footer) */}
            <div className="inline-flex items-center">
              <ZleLogo variant="footer" className="zle-footer-logo" alt="ZLE" />
            </div>

            <p className="text-white/60 text-sm font-sans leading-relaxed mt-4">
              Český underground skate brand.
              <br />
              Raw × Crew × Real Life.
            </p>
          </div>

          <div>
            <h4 className="font-heading text-sm font-bold text-white tracking-wider mb-4">
              NAVIGACE
            </h4>
            <nav className="flex flex-col gap-2">
              <Link
                href="/shop"
                className="text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-footer-shop"
              >
                SHOP
              </Link>
              <Link
                href="/story"
                className="text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-footer-story"
              >
                STORY
              </Link>
              <Link
                href="/crew"
                className="text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-footer-crew"
              >
                CREW
              </Link>
              <Link
                href="/contact"
                className="text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-footer-contact"
              >
                KONTAKT
              </Link>
              <Link
                href="/legal"
                className="text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-footer-legal"
              >
                LEGAL
              </Link>
            </nav>
          </div>

          <div>
            <h4 className="font-heading text-sm font-bold text-white tracking-wider mb-4">
              KONTAKT
            </h4>
            <div className="flex flex-col gap-3">
              <a
                href="mailto:info@zleskate.cz"
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-email"
              >
                <Mail className="h-4 w-4" />
                info@zleskate.cz
              </a>

              <a
                href="https://instagram.com/zle.skate"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-instagram"
              >
                <Instagram className="h-4 w-4" />
                @zle.skate
              </a>

              <a
                href="https://totalboardshop.cz"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
                data-testid="link-totalboardshop"
              >
                <ExternalLink className="h-4 w-4" />
                TotalBoardShop
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10">
          <p className="text-center text-white/40 text-xs font-sans">
            {new Date().getFullYear()} ZLE. Jeď to zle.
          </p>
        </div>
      </div>
    </footer>
  );
}
