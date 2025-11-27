import { storyItems } from "@/data/story";

export function StoryTimeline() {
  return (
    <div className="relative">
      <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-px bg-white/20" />

      <div className="space-y-12 md:space-y-20">
        {storyItems.map((item, index) => (
          <div
            key={item.id}
            className={`relative flex flex-col md:flex-row items-start gap-6 md:gap-12 opacity-0 animate-fade-in ${
              index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
            }`}
            style={{ animationDelay: `${index * 0.15}s` }}
            data-testid={`story-item-${item.id}`}
          >
            <div className="absolute left-4 md:left-1/2 w-3 h-3 bg-white rounded-full transform -translate-x-1/2 mt-2 z-10" />

            <div
              className={`flex-1 pl-12 md:pl-0 ${
                index % 2 === 0 ? "md:text-right md:pr-12" : "md:pl-12"
              }`}
            >
              <span className="font-display text-4xl md:text-5xl text-white/30 block mb-2">
                {item.year}
              </span>
              <h3 className="font-display text-xl md:text-2xl text-white tracking-tight mb-3">
                {item.title}
              </h3>
              <p className="font-sans text-white/70 text-sm md:text-base leading-relaxed max-w-sm">
                {item.description}
              </p>
            </div>

            <div className="flex-1 pl-12 md:pl-0">
              <div
                className={`aspect-[4/3] overflow-hidden bg-white/5 max-w-md ${
                  index % 2 === 0 ? "md:ml-12" : "md:mr-12"
                }`}
              >
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover grayscale hover:scale-105 transition-transform duration-500"
                  style={{ filter: "grayscale(100%) contrast(1.1)" }}
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
