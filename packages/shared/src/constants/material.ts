/**
 * Material vocabulary.
 *
 * Requirements 19.2 fixed the V1 scope at "V1 нэр/тоо; дараа нь агуулахын үлдэгдэлтэй
 * холбоно" — a material was a name typed freehand on the work it belonged to. A catalogue
 * now sits behind the name so usage can be reported on: the same item typed six ways
 * could never be totalled. Stock balances are still deliberately absent, so nothing here
 * models availability and no usage row is ever refused for want of quantity on hand;
 * warehouse integration remains the later phase requirement 19.2 describes.
 *
 * The unit list is shared by planned-work tasks, which measure their own progress in the
 * same units.
 */
export const MATERIAL_UNITS = [
  'PIECE',
  'METRE',
  'KILOGRAM',
  'LITRE',
  'SET',
  'BOX',
  'ROLL',
] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

export const MATERIAL_UNIT_LABELS: Record<MaterialUnit, string> = {
  PIECE: 'Шир',
  METRE: 'Метр',
  KILOGRAM: 'Кг',
  LITRE: 'Литр',
  SET: 'Хүрээлэн',
  BOX: 'Хайрцаг',
  ROLL: 'Ороомог',
};

/**
 * What a catalogue item is for, used to group a long picker.
 *
 * Coarse on purpose: the list exists so a technician can find a cable among four hundred
 * rows, not to drive any rule. Nothing branches on the category.
 */
export const MATERIAL_CATEGORIES = [
  'CABLE',
  'BREAKER',
  'LIGHTING',
  'FIXING',
  'CONSUMABLE',
  'TOOL',
  'OTHER',
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  CABLE: 'Кабель, дамжуулагч',
  BREAKER: 'Таслуур, хамгаалалт',
  LIGHTING: 'Гэрэлтүүлэг',
  FIXING: 'Бэхэлгээ, холбоос',
  CONSUMABLE: 'Хэрэглээний материал',
  TOOL: 'Багаж',
  OTHER: 'Бусад',
};
