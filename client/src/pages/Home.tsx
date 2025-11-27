import { Layout } from "@/components/layout/Layout";
import { Hero } from "@/components/home/Hero";
import { VibeSection } from "@/components/home/VibeSection";
import { FeaturedProducts } from "@/components/home/FeaturedProducts";

export default function Home() {
  return (
    <Layout>
      <Hero />
      <VibeSection />
      <FeaturedProducts />
    </Layout>
  );
}
