import { useState, useRef } from "react";
import { safePublicUrl } from "@/lib/safeUrl";
import { Film } from "lucide-react";

interface SafeVideoProps {
  src?: string;
  className?: string;
  poster?: string;
  fallbackPoster?: string;
  controls?: boolean;
  preload?: "none" | "metadata" | "auto";
  muted?: boolean;
  playsInline?: boolean;
}

const DEFAULT_FALLBACK_POSTER = "/crew-videos/_fallback.jpg";

function VideoPlaceholder({ poster, className }: { poster: string; className?: string }) {
  return (
    <div 
      className={`relative flex items-center justify-center bg-black ${className || ""}`}
      style={{ backgroundImage: `url(${poster})`, backgroundSize: "cover", backgroundPosition: "center" }}
    >
      <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
        <Film className="w-12 h-12 text-white/30 mb-2" />
        <span className="font-heading text-xs text-white/40 tracking-wider">VIDEO BRZY</span>
      </div>
    </div>
  );
}

export function SafeVideo({
  src,
  className = "",
  poster,
  fallbackPoster = DEFAULT_FALLBACK_POSTER,
  controls = true,
  preload = "metadata",
  muted = false,
  playsInline = true,
}: SafeVideoProps) {
  const [step, setStep] = useState(0);
  const [hasError, setHasError] = useState(false);
  const warnedRef = useRef(false);

  const safePoster = poster ? safePublicUrl(poster) : fallbackPoster;

  if (!src || src.trim() === "") {
    return <VideoPlaceholder poster={safePoster} className={className} />;
  }

  const getSrcForStep = (currentStep: number): string => {
    switch (currentStep) {
      case 0:
        return safePublicUrl(src);
      case 1:
        return src;
      default:
        return "";
    }
  };

  const handleError = () => {
    if (step < 2) {
      if (import.meta.env.DEV && !warnedRef.current) {
        warnedRef.current = true;
        console.warn(`[SafeVideo] Failed to load: step=${step}, src="${src}"`);
      }
      if (step === 1) {
        setHasError(true);
      } else {
        setStep((prev) => prev + 1);
      }
    }
  };

  if (hasError) {
    return <VideoPlaceholder poster={safePoster} className={className} />;
  }

  const currentSrc = getSrcForStep(step);

  return (
    <video
      className={className}
      controls={controls}
      preload={preload}
      muted={muted}
      playsInline={playsInline}
      poster={safePoster}
      onError={handleError}
    >
      <source src={currentSrc} type="video/mp4" />
    </video>
  );
}
