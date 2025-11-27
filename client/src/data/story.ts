import type { StoryItem } from "@shared/schema";

import urbanImg from "@assets/generated_images/urban_skate_scene_grain.png";
import streetImg from "@assets/generated_images/street_corner_urban.png";
import crewImg from "@assets/generated_images/crew_silhouettes_grain.png";
import skateImg from "@assets/generated_images/skateboard_detail_grain.png";

export const storyItems: StoryItem[] = [
  {
    id: "story-1",
    year: "2018",
    title: "ZAČÁTEK",
    description: "Black Bridge Bastards. Parta lidí, co spolu jezdila, bavila se a nic neřešila. První myšlenka na něco většího.",
    image: streetImg,
  },
  {
    id: "story-2",
    year: "2019",
    title: "PRVNÍ TRIKA",
    description: "Prvních 20 triček. Ruční tisk v garáži. Prodáno během týdne. Lidi to chtěli.",
    image: skateImg,
  },
  {
    id: "story-3",
    year: "2020",
    title: "ZLE SE RODÍ",
    description: "Název ZLE. Jednoduché. Výstižné. Jeď to zle. Značka dostala tvář.",
    image: crewImg,
  },
  {
    id: "story-4",
    year: "2021",
    title: "CREW ROSTE",
    description: "Víc lidí, víc energie. První kolekce hoodies. Real underground shit.",
    image: urbanImg,
  },
  {
    id: "story-5",
    year: "2022",
    title: "ULICE MLUVÍ",
    description: "ZLE na ulicích Prahy, Brna, Ostravy. Lidi to nosí. Community roste.",
    image: streetImg,
  },
  {
    id: "story-6",
    year: "2023",
    title: "DNESKA",
    description: "Full merch lineup. Crew je silnější než kdy dřív. Story pokračuje.",
    image: crewImg,
  },
];
