import type { CrewMember } from "@shared/schema";

import crewImg from "@assets/generated_images/crew_silhouettes_grain.png";
import skateImg from "@assets/generated_images/skateboard_detail_grain.png";
import sneakersImg from "@assets/generated_images/sneakers_skateboard_detail.png";

export const crewMembers: CrewMember[] = [
  {
    id: "crew-1",
    nickname: "FROST",
    vibe: "OG founder, raw style, street legend",
    image: crewImg,
  },
  {
    id: "crew-2",
    nickname: "GHOST",
    vibe: "Silent rider, heavy tricks, no talking",
    image: skateImg,
  },
  {
    id: "crew-3",
    nickname: "SPARK",
    vibe: "Young blood, crazy energy, fire moves",
    image: sneakersImg,
  },
  {
    id: "crew-4",
    nickname: "SHADE",
    vibe: "Night rider, urban explorer, photo master",
    image: crewImg,
  },
  {
    id: "crew-5",
    nickname: "STEEL",
    vibe: "Heavy hitter, no fear, concrete jungle",
    image: skateImg,
  },
  {
    id: "crew-6",
    nickname: "VAPOR",
    vibe: "Smooth flow, technical precision, zen mode",
    image: sneakersImg,
  },
];
