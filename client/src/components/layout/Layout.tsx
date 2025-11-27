import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BackgroundCollage } from "./BackgroundCollage";
import { GrainOverlay } from "./GrainOverlay";
import { CartDrawer } from "@/components/shop/CartDrawer";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-black text-white">
      <BackgroundCollage />
      <GrainOverlay />
      <Header />
      <main className="pt-16 md:pt-20">
        {children}
      </main>
      <Footer />
      <CartDrawer />
    </div>
  );
}
