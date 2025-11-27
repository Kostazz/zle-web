import { Layout } from "@/components/layout/Layout";
import { CrewList } from "@/components/crew/CrewList";

export default function Crew() {
  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 md:mb-16 max-w-2xl">
            <h1 
              className="font-display text-4xl md:text-6xl text-white tracking-tight mb-4 opacity-0 animate-fade-in zle-text-3d"
              data-testid="text-crew-title"
            >
              CREW
            </h1>
            <p className="font-sans text-lg text-white/60 opacity-0 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              Lidi, co stojí za ZLE. Žádný influenceři, jenom real riders.
            </p>
          </div>

          <CrewList />
        </div>
      </section>
    </Layout>
  );
}
