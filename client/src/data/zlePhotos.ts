export type ZlePhotos = {
  hero: string[];
  vibe: string[];
  crew: string[];
};

const base = "/images/zle-photos";

export const zlePhotos: ZlePhotos = {
  // Home PhotoGrid počítá s minimálně 6 kusy (indexy 0–5)
  hero: [
    `${base}/hero/482962260_672715478670567_9138744049105169252_n.jpg`,
    `${base}/hero/490969493_9465249883567716_45085364111691781_n.jpg`,
    `${base}/hero/566224854_841810661761047_3308462119001091558_n.jpg`,
    `${base}/events/465887700_562845979664892_2375756772027174848_n.jpg`,
    `${base}/events/466398027_562848076331349_5013157104235974205_n.jpg`,
    `${base}/events/469899015_581517034464453_6685181976256448963_n.jpg`,
  ],

  // VibeSection počítá s minimálně 3 kusy
  vibe: [
    `${base}/collage/WhatsApp Image 2025-11-26 at 19.46.50.jpeg`,
    `${base}/collage/WhatsApp Image 2025-11-26 at 20.09.25 (1).jpeg`,
    `${base}/collage/WhatsApp Image 2025-11-26 at 20.09.25 (2).jpeg`,
  ],

  // CrewRotator: funguje i s 3 kusy (jen nebude “nový” pool)
  crew: [
    `${base}/crew/WhatsApp Image 2025-11-26 at 19.40.49 (2).jpeg`,
    `${base}/crew/WhatsApp Image 2025-11-26 at 19.41.07.jpeg`,
    `${base}/crew/WhatsApp Image 2025-11-26 at 20.09.27 (1).jpeg`,
  ],
};
