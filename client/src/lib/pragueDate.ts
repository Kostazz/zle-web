export function getPragueDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Prague" });
}

export function getPragueDateSeed(): number {
  const pragueDate = getPragueDateString();
  const [year, month, day] = pragueDate.split("-").map(Number);
  return year * 10000 + month * 100 + day;
}

export function getPragueDayOfMonth(): number {
  const pragueDate = getPragueDateString();
  return parseInt(pragueDate.split("-")[2], 10);
}
