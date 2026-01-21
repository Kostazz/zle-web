import { SafeImage } from "@/components/SafeImage";

type GridImage = {
  src: string;
  alt: string;
};

const IMAGES: GridImage[] = [
  {
    src: "/images/zle-photos/events/476118038_646344201307695_3945339985618919437_n.jpg",
    alt: "ZLE event 01",
  },
  {
    src: "/images/zle-photos/events/475944748_645588801383235_7822522371695246484_n.jpg",
    alt: "ZLE event 02",
  },
  {
    src: "/images/zle-photos/events/472606843_18003548594725024_1269219565505133879_n.jpg",
    alt: "ZLE event 03",
  },
  {
    src: "/images/zle-photos/events/469978573_581510404465116_6203274925219875620_n.jpg",
    alt: "ZLE event 04",
  },
  {
    src: "/images/zle-photos/events/466043598_562845286331628_7467343908967591947_n.jpg",
    alt: "ZLE event 05",
  },
  {
    src: "/images/zle-photos/events/275685083_117598580856303_3141185152964779387_n.jpg",
    alt: "ZLE event 06",
  },
];

export function PhotoGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
      {IMAGES.map((img, idx) => (
        <div
          key={`${img.src}-${idx}`}
          className="zle-photo-frame overflow-hidden aspect-[4/3] bg-black/50"
        >
          <SafeImage
            src={img.src}
            alt={img.alt}
            className="w-full h-full object-cover zle-bw-photo"
            preferModernFormats
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
}
