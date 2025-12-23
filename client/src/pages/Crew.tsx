import { Layout } from "@/components/layout/Layout";
import { CrewList } from "@/components/crew/CrewList";
import { CrewRotator } from "@/components/crew/CrewRotator";
import { CrewVideoWall } from "@/components/crew/CrewVideoWall";

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

          <div className="mb-16 md:mb-20">
            <h2 className="font-heading text-xl md:text-2xl text-white/80 tracking-wider mb-6 zle-text-3d-subtle">
              CREW V POHYBU
            </h2>
            <CrewRotator />
          </div>

          <div className="mb-16 md:mb-20">
            <h2 className="font-heading text-xl md:text-2xl text-white/80 tracking-wider mb-6 zle-text-3d-subtle">
              POZNEJ NÁS
            </h2>
            <CrewList />
          </div>

          <div>
            <h2 className="font-heading text-xl md:text-2xl text-white/80 tracking-wider mb-6 zle-text-3d-subtle">
              CREW VIDEOS
            </h2>
            <CrewVideoWall />
          </div>
        </div>
      </section>
    </Layout>
  );
}
