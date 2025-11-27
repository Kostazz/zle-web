import { Layout } from "@/components/layout/Layout";
import { StoryTimeline } from "@/components/story/StoryTimeline";

export default function Story() {
  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 md:mb-24 max-w-2xl">
            <h1 
              className="font-display text-4xl md:text-6xl text-white tracking-tight mb-4 opacity-0 animate-fade-in zle-text-3d"
              data-testid="text-story-title"
            >
              STORY
            </h1>
            <p className="font-sans text-lg text-white/60 opacity-0 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              Od Black Bridge Bastards k ZLE. Raw příběh, žádný bullshit.
            </p>
          </div>

          <StoryTimeline />
        </div>
      </section>
    </Layout>
  );
}
