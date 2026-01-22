import * as React from "react";
import { getModernFormatVariants } from "@/lib/imageLoader";

type SafeImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallbackSrc?: string;
  preferModernFormats?: boolean;
  priority?: boolean;
};

const DEFAULT_FALLBACK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function isRemote(url: string) {
  return /^https?:\/\//i.test(url);
}

function encodeLocalPath(input: string) {
  if (!input) return input;
  if (isRemote(input)) return input;

  const i = input.search(/[?#]/);
  const path = i === -1 ? input : input.slice(0, i);
  const suffix = i === -1 ? "" : input.slice(i);

  return encodeURI(path) + suffix;
}

function ensureLeadingSlash(url: string) {
  if (!url) return url;
  const u = url.startsWith("/") ? url : `/${url}`;
  return encodeLocalPath(u);
}

type Variants = {
  fallbackSrc: string;
  webpSrc?: string;
  avifSrc?: string;
};

export function SafeImage({
  src,
  alt = "",
  fallbackSrc = DEFAULT_FALLBACK,
  preferModernFormats = true,
  priority = false,
  loading = "lazy",
  decoding = "async",
  onError,
  ...props
}: SafeImageProps) {
  const normalized = React.useMemo(() => {
    const raw = src?.trim();
    if (!raw) return fallbackSrc;
    if (isRemote(raw)) return raw;
    return ensureLeadingSlash(raw);
  }, [src, fallbackSrc]);

  const [currentSrc, setCurrentSrc] = React.useState<string>(normalized);

  React.useEffect(() => {
    setCurrentSrc(normalized);
  }, [normalized]);

  const finalLoading = priority ? "eager" : loading;

  const imgProps = props as React.ImgHTMLAttributes<HTMLImageElement> & {
    fetchPriority?: "high" | "low" | "auto";
  };
  const fetchPriority = priority ? "high" : imgProps.fetchPriority;

  const variants: Variants = React.useMemo(() => {
    if (!preferModernFormats || isRemote(currentSrc)) {
      return { fallbackSrc: currentSrc };
    }

    const v = getModernFormatVariants(currentSrc) as unknown as {
      webpSrc?: string;
      avifSrc?: string;
      webp?: string;
      avif?: string;
    };

    return {
      fallbackSrc: currentSrc,
      webpSrc: v.webpSrc ?? v.webp,
      avifSrc: v.avifSrc ?? v.avif,
    };
  }, [preferModernFormats, currentSrc]);

  const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    onError?.(e);
    if (currentSrc !== fallbackSrc) setCurrentSrc(fallbackSrc);
  };

  const hasModern = Boolean(variants.avifSrc || variants.webpSrc);

  if (hasModern) {
    return (
      <picture>
        {variants.avifSrc && (
          <source srcSet={variants.avifSrc} type="image/avif" />
        )}
        {variants.webpSrc && (
          <source srcSet={variants.webpSrc} type="image/webp" />
        )}
        <img
          {...imgProps}
          src={variants.fallbackSrc}
          alt={alt}
          loading={finalLoading}
          decoding={decoding}
          fetchPriority={fetchPriority}
          onError={handleError}
        />
      </picture>
    );
  }

  return (
    <img
      {...imgProps}
      src={variants.fallbackSrc}
      alt={alt}
      loading={finalLoading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      onError={handleError}
    />
  );
}
