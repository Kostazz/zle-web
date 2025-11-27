import { crewMembers } from "@/data/crew";

export function CrewList() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
      {crewMembers.map((member, index) => (
        <div
          key={member.id}
          className="group opacity-0 animate-fade-in"
          style={{ animationDelay: `${index * 0.1}s` }}
          data-testid={`crew-member-${member.id}`}
        >
          <div className="relative aspect-square overflow-hidden bg-white/5 mb-4">
            <img
              src={member.image}
              alt={member.nickname}
              className="w-full h-full object-cover grayscale group-hover:scale-105 transition-transform duration-500"
              style={{ 
                filter: "grayscale(100%) contrast(1.2) brightness(0.9)",
              }}
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6">
              <h3 className="font-display text-2xl md:text-3xl text-white tracking-tight mb-1">
                {member.nickname}
              </h3>
              <p className="font-sans text-sm text-white/70 italic">
                {member.vibe}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
