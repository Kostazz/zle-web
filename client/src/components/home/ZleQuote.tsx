import { useState, useEffect } from "react";
import { getTodayQuote, type ZleQuoteData } from "@/data/zleQuotes";

export function ZleQuote() {
  const [quote, setQuote] = useState<ZleQuoteData | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const todayQuote = getTodayQuote();
    setQuote(todayQuote);
    
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  if (!quote) return null;

  return (
    <section className="relative py-16 md:py-24 overflow-hidden">
      <div className="absolute inset-0 bg-black/60" />
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
        }}
      />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          <h2 
            className="font-heading text-2xl md:text-4xl text-white tracking-wider mb-8 zle-text-3d"
            data-testid="text-quote-title"
          >
            DNEŠNÍ ZLE HLÁŠKA
          </h2>
          
          <div 
            className={`transition-all duration-1000 ${
              isVisible 
                ? "opacity-100 translate-y-0" 
                : "opacity-0 translate-y-4"
            }`}
          >
            <p 
              className="text-white text-xl md:text-3xl font-medium leading-relaxed max-w-3xl mx-auto"
              style={{
                textShadow: "0 0 20px rgba(255, 255, 255, 0.15), 1px 1px 0 rgba(0, 0, 0, 0.6)",
              }}
              data-testid="text-daily-line"
            >
              {quote.dailyLine}
            </p>
          </div>
          
          <div className="mt-8 flex justify-center">
            <span className="text-white/40 text-sm tracking-widest font-mono">
              ZLE DAILY LINE ENGINE
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
