type DailyLineResult = { text: string };

export function getPragueYYYYMMDD(d = new Date()): string {
  // YYYY-MM-DD v Europe/Prague
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!y || !m || !day) throw new Error("Failed to compute Prague date");
  return `${y}-${m}-${day}`;
}

export async function generateDailyLineOpenAI(args: {
  apiKey: string;
  model: string;
  seed: string; // YYYY-MM-DD
}): Promise<DailyLineResult> {
  const { apiKey, model, seed } = args;

  const prompt = [
    "Write ONE ZLE daily line (1–2 short sentences).",
    "Language: Czech with an occasional English punchline (natural, not forced).",
    "Vibe: underground skate, raw, funny, punk/ironic, confident.",
    "No emojis. No hashtags. No quotes. No prefixes like 'Daily line:'.",
    "No dates, no day names, no references to being an AI.",
    `Seed concept (do not mention it): ${seed}`,
    "Return ONLY the final line.",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a sharp underground copywriter for a skate brand." },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 80,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${res.status} ${res.statusText} ${txt}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();

  if (!text || typeof text !== "string") throw new Error("OpenAI returned empty content");

  return { text: text.replace(/^"+|"+$/g, "").trim() };
}
