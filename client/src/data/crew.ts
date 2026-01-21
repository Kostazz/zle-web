export type CrewMember = {
  id: string;
  nickname: string;
  vibe: string;
  image: string;
};

const base = "/images/zle-photos/crew";

export const crewMembers: CrewMember[] = [
  {
    id: "crew-1",
    nickname: "Crew",
    vibe: "raw / street / no filter",
    image: `${base}/WhatsApp Image 2025-11-26 at 19.40.49 (2).jpeg`,
  },
  {
    id: "crew-2",
    nickname: "Crew",
    vibe: "skate / punk / zine energy",
    image: `${base}/WhatsApp Image 2025-11-26 at 19.41.07.jpeg`,
  },
  {
    id: "crew-3",
    nickname: "Crew",
    vibe: "session mode / night ride",
    image: `${base}/WhatsApp Image 2025-11-26 at 20.09.27 (1).jpeg`,
  },
];
