export interface OrefAlert {
  id: string;
  cat: number;       // alert category (1=missiles, 2=aircraft, etc.)
  title: string;     // Hebrew title from Pikud Ha'oref
  data: string[];    // array of Hebrew city names
  desc: string;      // instructions
}

// Raw shape from the API (before normalization)
export interface OrefApiResponse {
  id: string;
  cat: string;       // comes as string from API
  title: string;
  data: string[];
  desc: string;
}

export const ALERT_CATEGORIES: Record<number, string> = {
  1: 'ירי רקטות וטילים',
  2: 'חדירת כלי טיס עוין',
  3: 'רעידת אדמה',
  4: 'צונאמי',
  5: 'חדירת מחבלים',
  6: 'חומרים מסוכנים',
  7: 'לוחמה לא קונבנציונלית',
  13: 'ניתן לצאת מהמרחב המוגן',
  101: 'אירוע חירום',
};
