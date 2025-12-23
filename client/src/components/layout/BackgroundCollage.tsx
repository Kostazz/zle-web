import { useEffect, useState } from "react";
import { SafeImage } from "@/components/SafeImage";

const collageImages = [
  "/zle-photos/collage/466633752_563437729605717_6859405490420458826_n.jpg",
  "/zle-photos/collage/469978573_581510404465116_6203274925219875620_n.jpg",
  "/zle-photos/collage/475944748_645588801383235_7822522371695246484_n.jpg",
  "/zle-photos/collage/482962260_672715478670567_9138744049105169252_n.jpg",
  "/zle-photos/collage/490969493_9465249883567716_45085364111691781_n.jpg",
  "/zle-photos/events/465887700_562845979664892_2375756772027174848_n.jpg",
  "/zle-photos/events/466043598_562845286331628_7467343908967591947_n.jpg",
  "/zle-photos/events/469899015_581517034464453_6685181976256448963_n.jpg",
  "/zle-photos/events/472313581_597125122903644_2724985617026038877_n.jpg",
];

export function BackgroundCollage() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div 
        className="absolute inset-0 grid grid-cols-3 gap-0"
        style={{
          transform: `translateY(${scrollY * 0.15}px)`,
        }}
      >
        {collageImages.map((img, i) => (
          <div 
            key={i}
            className="relative w-full h-[50vh]"
            style={{
              transform: `translateY(${(i % 3) * 20}px)`,
            }}
          >
            <SafeImage
              src={img}
              alt=""
              className="w-full h-full object-cover"
              style={{
                filter: "grayscale(100%) contrast(0.9) blur(2px)",
                opacity: 0.15,
              }}
              loading="lazy"
            />
          </div>
        ))}
      </div>
      <div 
        className="absolute inset-0 bg-black opacity-85"
        aria-hidden="true"
      />
      <div 
        className="absolute inset-0 bg-noise opacity-20 pointer-events-none mix-blend-overlay"
        aria-hidden="true"
      />
    </div>
  );
}
