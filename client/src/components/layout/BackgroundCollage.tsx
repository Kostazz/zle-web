import { SafeImage } from "@/components/SafeImage";

type CollageItem = {
  src: string;
  alt?: string;
  className?: string;
};

const COLLAGE: CollageItem[] = [
  {
    src: "/images/zle-photos/collage/466633752_563437729605717_6859405490420458826_n.jpg",
    alt: "ZLE collage",
    className: "absolute -left-12 top-10 w-72 opacity-25 rotate-[-6deg]",
  },
  {
    src: "/images/zle-photos/collage/469978573_581510404465116_6203274925219875620_n.jpg",
    alt: "ZLE collage",
    className: "absolute right-[-40px] top-24 w-80 opacity-20 rotate-[8deg]",
  },
  {
    src: "/images/zle-photos/collage/475944748_645588801383235_7822522371695246484_n.jpg",
    alt: "ZLE collage",
    className: "absolute left-10 bottom-[-40px] w-96 opacity-20 rotate-[10deg]",
  },
  {
    src: "/images/zle-photos/collage/482962260_672715478670567_9138744049105169252_n.jpg",
    alt: "ZLE collage",
    className: "absolute right-10 bottom-[-30px] w-80 opacity-15 rotate-[-10deg]",
  },
  {
    src: "/images/zle-photos/collage/490969493_9465249883567716_45085364111691781_n.jpg",
    alt: "ZLE collage",
    className: "absolute left-[35%] top-[-30px] w-80 opacity-15 rotate-[3deg]",
  },
];

export function BackgroundCollage() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {COLLAGE.map((img, i) => (
        <SafeImage
          key={i}
          src={img.src}
          alt={img.alt ?? "ZLE"}
          className={img.className}
          aria-hidden="true"
        />
      ))}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
}
