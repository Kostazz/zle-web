export type StoryItem = {
  id: string;
  year: string;
  title: string;
  description: string;
  image?: string;
};

const base = "/images/zle-photos/events";

export const storyItems: StoryItem[] = [
  {
    id: "story-2021",
    year: "2021",
    title: "ZLE vzniká jako crew.",
    description: "Ne brand. Crew. Punk, skate, humor. Real life bez filtrů.",
    image: `${base}/465887700_562845979664892_2375756772027174848_n.jpg`,
  },
  {
    id: "story-2023",
    year: "2023",
    title: "Archiv ulic se plní.",
    description: "Pády, sessions, ziny, noci. ZLE chaos v detailech.",
    image: `${base}/466398027_562848076331349_5013157104235974205_n.jpg`,
  },
  {
    id: "story-2025",
    year: "2025",
    title: "ZLE jde online.",
    description: "Web jako digitální skate zine. Shop čistý, pozadí špinavý.",
    image: `${base}/469899015_581517034464453_6685181976256448963_n.jpg`,
  },
];
