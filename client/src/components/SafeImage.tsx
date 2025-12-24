import { useState, useRef } from "react";
import { safePublicUrl } from "@/lib/media";

interface SafeImageProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackSrc?: string;
  loading?: "eager" | "lazy";
  onLoad?: () => void;
  style?: React.CSSProperties;
}

const DEFAULT_FALLBACK = "/zle-photos/_fallback.jpg";

export function SafeImage({
  src,
  alt = "",
  className = "",
  fallbackSrc = DEFAULT_FALLBACK,
  loading = "lazy",
  onLoad,
  style,
}: SafeImageProps) {
  const [step, setStep] = useState(0);
  const warnedRef = useRef(false);

  const getSrcForStep = (currentStep: number): string => {
    switch (currentStep) {
      case 0:
        return safePublicUrl(src);
      case 1:
        return src || "";
      case 2:
      default:
        return fallbackSrc;
    }
  };

  const handleError = () => {
    if (step < 2) {
      if (import.meta.env.DEV && !warnedRef.current) {
        warnedRef.current = true;
        console.warn(`[SafeImage] Failed to load: step=${step}, src="${src}"`);
      }
      setStep((prev) => prev + 1);
    }
  };

  const currentSrc = getSrcForStep(step);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={handleError}
      onLoad={onLoad}
      style={style}
    />
  );
}
