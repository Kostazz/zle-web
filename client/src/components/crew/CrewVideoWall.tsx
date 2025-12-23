import { useState, useEffect } from "react";
import { crewVideos, formatDuration, isShortVideo, isLongVideo, type CrewVideo } from "@/data/crewVideos";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Clock, Eye, EyeOff, Film, AlertTriangle } from "lucide-react";

type FilterType = "all" | "premiere" | "public" | "short" | "long";

const filters: { id: FilterType; label: string }[] = [
  { id: "all", label: "VŠE" },
  { id: "premiere", label: "PREMIÉRY" },
  { id: "public", label: "VEŘEJNÉ" },
  { id: "short", label: "KRÁTKÉ" },
  { id: "long", label: "DLOUHÉ" },
];

function VideoSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="aspect-video bg-white/10 rounded-sm" />
      <Skeleton className="h-5 w-3/4 bg-white/10" />
      <Skeleton className="h-4 w-1/2 bg-white/10" />
    </div>
  );
}

function VideoPlaceholder({ title }: { title: string }) {
  return (
    <div className="aspect-video bg-white/5 border border-white/10 rounded-sm flex flex-col items-center justify-center">
      <Film className="w-12 h-12 text-white/20 mb-2" />
      <span className="font-heading text-xs text-white/30 tracking-wider text-center px-4">
        {title}
      </span>
    </div>
  );
}

function VideoNotFound() {
  return (
    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10">
      <AlertTriangle className="w-8 h-8 text-white/40 mb-2" />
      <span className="font-heading text-xs text-white/50 tracking-wider">VIDEO BRZY</span>
    </div>
  );
}

function VideoCard({ video }: { video: CrewVideo }) {
  const [videoError, setVideoError] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  
  const isPremiere = video.visibility === "shop";
  const duration = formatDuration(video.durationSec);
  const isShort = isShortVideo(video.durationSec);

  return (
    <div className="zle-card p-3 space-y-3" data-testid={`card-video-${video.id}`}>
      <div className="relative aspect-video overflow-hidden rounded-sm bg-black">
        {video.sourceType === "youtube" ? (
          <iframe
            src={video.src}
            title={video.title}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            loading="lazy"
          />
        ) : (
          <>
            {videoError && <VideoNotFound />}
            <video
              controls
              preload="metadata"
              playsInline
              className="w-full h-full object-cover"
              poster={video.thumb && !thumbError ? video.thumb : undefined}
              onError={() => setVideoError(true)}
            >
              <source src={video.src} type="video/mp4" />
            </video>
            {video.thumb && !thumbError && !videoError && (
              <img
                src={video.thumb}
                alt=""
                className="hidden"
                onError={() => setThumbError(true)}
              />
            )}
          </>
        )}
        
        {duration && (
          <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded-sm flex items-center gap-1 z-20">
            <Clock className="w-3 h-3 text-white/70" />
            <span className="font-mono text-xs text-white/90">{duration}</span>
          </div>
        )}
        
        {isPremiere && (
          <div className="absolute top-2 left-2 bg-white text-black px-2 py-1 rounded-sm z-20">
            <span className="font-heading text-xs tracking-wider flex items-center gap-1">
              <EyeOff className="w-3 h-3" />
              PREMIÉRA
            </span>
          </div>
        )}
      </div>
      
      <div className="space-y-2">
        <h3 className="font-heading text-sm md:text-base text-white tracking-wider zle-text-3d-subtle line-clamp-1">
          {video.title}
        </h3>
        
        <div className="flex items-center gap-2 flex-wrap">
          {video.visibility === "public" && (
            <span className="text-xs text-white/50 flex items-center gap-1">
              <Eye className="w-3 h-3" />
              Veřejné
            </span>
          )}
          {isShort && (
            <span className="text-xs text-white/50 border border-white/20 px-1.5 py-0.5 rounded-sm">
              Krátké
            </span>
          )}
          {video.date && (
            <span className="text-xs text-white/40">
              {new Date(video.date).toLocaleDateString("cs-CZ")}
            </span>
          )}
        </div>
        
        {video.description && (
          <p className="text-xs text-white/50 line-clamp-2">
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <Film className="w-16 h-16 text-white/20 mx-auto mb-4" />
      <p className="font-heading text-lg text-white/40 tracking-wider mb-2">
        ŽÁDNÁ VIDEA
      </p>
      <p className="font-sans text-sm text-white/30">
        V této kategorii zatím nemáme žádná videa.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="text-center py-16">
      <AlertTriangle className="w-16 h-16 text-white/20 mx-auto mb-4" />
      <p className="font-heading text-lg text-white/40 tracking-wider mb-2">
        NĚCO SE POKAZILO
      </p>
      <p className="font-sans text-sm text-white/30">
        Nepodařilo se načíst videa. Zkus to znovu později.
      </p>
    </div>
  );
}

export function CrewVideoWall() {
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    try {
      const timer = setTimeout(() => {
        setIsLoading(false);
      }, 200);
      return () => clearTimeout(timer);
    } catch {
      setHasError(true);
      setIsLoading(false);
    }
  }, []);

  const filteredVideos = crewVideos.filter((video) => {
    switch (activeFilter) {
      case "premiere":
        return video.visibility === "shop";
      case "public":
        return video.visibility === "public";
      case "short":
        return isShortVideo(video.durationSec);
      case "long":
        return isLongVideo(video.durationSec);
      default:
        return true;
    }
  });

  if (hasError) {
    return (
      <div className="min-h-[200px]">
        <ErrorState />
      </div>
    );
  }

  return (
    <div className="min-h-[200px]">
      <div className="flex flex-wrap gap-2 mb-6 md:mb-8">
        {filters.map((filter) => (
          <Button
            key={filter.id}
            variant={activeFilter === filter.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter(filter.id)}
            className={`font-heading text-xs tracking-wider ${
              activeFilter === filter.id
                ? "bg-white text-black hover:bg-white/90"
                : "border-white/30 text-white hover:bg-white hover:text-black"
            }`}
            aria-label={`Filtrovat: ${filter.label}`}
            aria-pressed={activeFilter === filter.id}
            data-testid={`button-filter-${filter.id}`}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <VideoSkeleton key={i} />
          ))}
        </div>
      ) : filteredVideos.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {filteredVideos.map((video, index) => (
            <div
              key={video.id}
              className="opacity-0 animate-fade-in"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <VideoCard video={video} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
