/** The things bought on the morning shopping trip, in the order the managers buy them. Saved as the bill's item. */
export const MORNING_ITEMS: { name: string; emoji: string }[] = [
  { name: "Kanda / Onion", emoji: "🧅" },
  { name: "Lasan / Garlic", emoji: "🧄" },
  { name: "Tomato", emoji: "🍅" },
  { name: "Aloo / Potato", emoji: "🥔" },
  { name: "Kobis / Cabbage", emoji: "🥬" },
  { name: "Beet / Beetroot", emoji: "🍠" },
  { name: "Lilo Kando / Green Onion", emoji: "🌱" },
  { name: "Lilo Lasan / Green Garlic", emoji: "🌱" },
  { name: "Dhaniya / Coriander", emoji: "🌿" },
  { name: "Hari Mirch / Green Chilli", emoji: "🌶️" },
  { name: "Adrak / Ginger", emoji: "🫚" },
  { name: "Kakdi / Cucumber", emoji: "🥒" },
  { name: "Singdana / Peanuts", emoji: "🥜" },
  { name: "Palak / Spinach", emoji: "🥬" },
  { name: "Gobi / Cauliflower", emoji: "🥦" },
  { name: "Dudhi / Gourd", emoji: "🍐" },
];
/** The last tile: anything else, with an optional line of text. */
export const MORNING_OTHERS = { name: "Others", emoji: "🛒" };

/** Splits a saved item back into the tile it came from (or Others with its text). */
export function morningItemOf(item: string | null | undefined): { pick: string; other: string } {
  const text = (item ?? "").trim();
  if (!text) return { pick: "", other: "" };
  if (MORNING_ITEMS.some((i) => i.name === text)) return { pick: text, other: "" };
  return { pick: MORNING_OTHERS.name, other: text === MORNING_OTHERS.name ? "" : text };
}

/** The item saved for a tile pick: the tile's name, or for Others what was typed (just "Others" when nothing was). */
export function morningItemText(pick: string, other: string): string | null {
  if (!pick) return null;
  if (pick !== MORNING_OTHERS.name) return pick;
  return other.trim() || MORNING_OTHERS.name;
}
