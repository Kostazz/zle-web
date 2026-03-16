import { useEffect } from "react";
import { Link } from "wouter";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useOverlay } from "@/lib/overlay-context";

const secondaryLinks = [
  { href: "/story", label: "STORY" },
  { href: "/crew", label: "CREW" },
  { href: "/contact", label: "KONTAKT" },
];

type MobileNavDrawerProps = {
  location: string;
};

const isShopRoute = (location: string) => location === "/shop" || location.startsWith("/shop/");

export function MobileNavDrawer({ location }: MobileNavDrawerProps) {
  const { isOpen, closeOverlay } = useOverlay();
  const isMenuOpen = isOpen("mobile-menu");
  const isShopActive = isShopRoute(location);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const closeButton = document.querySelector<HTMLButtonElement>(".zle-mobile-nav-sheet > button");
    if (closeButton) {
      closeButton.setAttribute("aria-label", "Zavřít navigaci");
    }
  }, [isMenuOpen]);

  const closeDrawer = () => {
    closeOverlay("mobile-menu");
  };

  return (
    <Sheet
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeDrawer();
        }
      }}
    >
      <SheetContent
        side="right"
        aria-describedby="zle-mobile-nav-description"
        className="zle-mobile-nav-sheet md:hidden"
      >
        <SheetTitle className="sr-only">Mobilní navigace ZLE</SheetTitle>
        <SheetDescription id="zle-mobile-nav-description" className="sr-only">
          Hlavní navigace webu ZLE.
        </SheetDescription>

        <div className="zle-mobile-nav-layout">
          <div className="zle-mobile-nav-branding">
            <p className="zle-mobile-nav-kicker">ZLE SKATE</p>
            <p className="zle-mobile-nav-subtitle">MOBILE NAVIGATION</p>
          </div>

          <nav aria-label="Mobilní menu" className="zle-mobile-nav-main">
            <Link
              href="/shop"
              className={`zle-mobile-nav-shop-cta ${isShopActive ? "zle-mobile-nav-shop-cta-active" : ""}`}
              onClick={closeDrawer}
            >
              <span>SHOP</span>
              <span aria-hidden="true">→</span>
            </Link>
            <p className="zle-mobile-nav-shop-support">Vstup do shopu.</p>

            <ul className="zle-mobile-nav-links" role="list">
              {secondaryLinks.map((link) => {
                const isActive = location === link.href;

                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`zle-mobile-nav-link ${isActive ? "zle-mobile-nav-link-active" : ""}`}
                      onClick={closeDrawer}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="zle-mobile-nav-utility" aria-label="ZLE utility links">
            <a
              href="https://instagram.com/zle.skate"
              target="_blank"
              rel="noreferrer noopener"
              className="zle-mobile-nav-utility-link"
              onClick={closeDrawer}
            >
              Instagram
            </a>
            <a href="mailto:info@zleskate.cz" className="zle-mobile-nav-utility-link" onClick={closeDrawer}>
              Email
            </a>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
