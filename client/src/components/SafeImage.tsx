import * as React from "react";
import { getModernFormatVariants } from "@/lib/imageLoader";

type SafeImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallbackSrc?: string;
  /** Když je src .jpg/.jpeg/.png, zkusí nejdřív .avif a .webp (přes imageLoader) */
  preferModernFormats?: boolean;
  /** Prioritní načtení (LCP / hero) */
  priority?: boolean;
};

const DEFAULT_FALLBACK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function isRemote(url: string) {
  return /^https?:\/\//i.test(url);
}

function ensureLeadingSlash(url: string) {
  if (!url) return url;
  if (url.startsWith("/")) return url;
  return `/${url}`;
}

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
    return isRemote(raw) ? raw : ensureLeadingSlash(raw);
  }, [src, fallbackSrc]);

  const [currentSrc, setCurrentSrc] = React.useState<string>(normalized);

  React.useEffect(() => {
    setCurrentSrc(normalized);
  }, [normalized]);

  const finalLoading: React.ImgHTMLAttributes<HTMLImageElement>["loading"] =
    priority ? "eager" : loading;

  // fetchPriority není ve všech typech TS, ale v DOM to dnes běžně existuje
  const imgProps = props as React.ImgHTMLAttributes<HTMLImageElement> & {
    fetchPriority?: "high" | "low" | "auto";
  };

  const fetchPriority = priority ? "high" : imgProps.fetchPriority;

  const isCurrentRemote = isRemote(currentSrc);

  // ✅ Jediná logika pro moderní fallback jde z imageLoader (žádné duplikace)
  const variants =
    preferModernFormats && !isCurrentRemote
      ? getModernFormatVariants(currentSrc)
      : { fallbackSrc: currentSrc };

  const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    // nejdřív zavoláme user handler, ať se nic neztratí
    onError?.(e);
    // pak bezpečný fallback (ať se to nezacyklí)
    if (currentSrc !== fallbackSrc) setCurrentSrc(fallbackSrc);
  };

  // Když nemáme moderní varianty, renderujeme jen <img>
  const hasModern = Boolean(variants.avifSrc || variants.webpSrc);

  if (hasModern) {
    return (
      <picture>
        {variants.avifSrc ? (
          <source srcSet={variants.avifSrc} type="image/avif" />
        ) : null}
        {variants.webpSrc ? (
          <source srcSet={variants.webpSrc} type="image/webp" />
        ) : null}

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
