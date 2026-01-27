import { createMessage } from './ai.js';
import * as fatsecret from './fatsecret.js';
import type { Meal } from '../db/schema.js';

export type ParsedFood = {
  items: {
    description: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    source?: 'fatsecret' | 'ai'; // Track where data came from
  }[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
};

type ParsedItem = {
  item: string;      // Searchable food name
  quantity: number;  // Number of servings
  unit: string;      // Serving unit (e.g., "oz", "cup", "piece")
};

// Use Claude to parse user input into searchable items
async function parseIntoSearchTerms(userInput: string): Promise<ParsedItem[]> {
  const response = await createMessage('nutrition', {
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Parse this food entry into individual searchable items. Extract the food name (simple, searchable) and quantity.

Food entry: "${userInput}"

Respond ONLY with JSON array:
[{"item": "scrambled eggs", "quantity": 4, "unit": "large"}, {"item": "white toast", "quantity": 2, "unit": "slice"}]

Rules:
- Keep item names simple and searchable (e.g., "chicken breast" not "grilled seasoned chicken breast")
- Extract quantities as numbers
- Default to reasonable portions if not specified
- Separate combo items (e.g., "eggs and toast" becomes two items)`
      }
    ]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return [];
  }

  try {
    let jsonStr = content.text;
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    return JSON.parse(jsonStr) as ParsedItem[];
  } catch {
    return [];
  }
}

// AI fallback estimation (original method)
async function estimateWithAI(userInput: string, dietType?: string): Promise<ParsedFood> {
  const dietNote = dietType
    ? `\nNote: User follows a ${dietType} diet.`
    : '';

  const response = await createMessage('nutrition', {
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Parse this food entry and estimate macros. Be accurate - use standard USDA values.

Food entry: "${userInput}"

Respond ONLY with valid JSON:
{
  "items": [{"description": "Food with portion", "calories": 0, "protein": 0, "carbs": 0, "fat": 0}],
  "totalCalories": 0,
  "totalProtein": 0,
  "totalCarbs": 0,
  "totalFat": 0
}

Rules:
- All values should be integers
- Use realistic portion sizes if not specified
- For restaurant food, estimate on the higher side${dietNote}`
      }
    ]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  let jsonStr = content.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1] || jsonMatch[0];
  }

  const parsed = JSON.parse(jsonStr) as ParsedFood;
  // Mark items as AI-sourced
  parsed.items = parsed.items.map(item => ({ ...item, source: 'ai' as const }));
  return parsed;
}

// Main function: Try FatSecret first, fall back to AI
export async function parseFoodEntry(userInput: string, dietType?: string): Promise<ParsedFood> {
  // If FatSecret isn't configured, use AI only
  if (!fatsecret.isConfigured()) {
    return estimateWithAI(userInput, dietType);
  }

  try {
    // Step 1: Parse input into searchable items
    const searchTerms = await parseIntoSearchTerms(userInput);

    if (searchTerms.length === 0) {
      return estimateWithAI(userInput, dietType);
    }

    const items: ParsedFood['items'] = [];

    // Step 2: Search FatSecret for each item
    for (const term of searchTerms) {
      const searchQuery = `${term.quantity} ${term.unit} ${term.item}`;

      try {
        const results = await fatsecret.searchFoods(term.item, 3);

        if (results.length > 0) {
          // Use the first result's description to get nutrition
          const parsed = fatsecret.parseDescription(results[0].food_description);

          if (parsed) {
            // Scale by quantity (FatSecret returns per-serving values)
            const multiplier = term.quantity;
            items.push({
              description: `${term.quantity} ${term.unit} ${results[0].food_name}`,
              calories: Math.round(parsed.calories * multiplier),
              protein: Math.round(parsed.protein * multiplier),
              carbs: Math.round(parsed.carbs * multiplier),
              fat: Math.round(parsed.fat * multiplier),
              source: 'fatsecret',
            });
            continue;
          }
        }
      } catch (e) {
        console.error(`FatSecret search failed for "${term.item}":`, e);
      }

      // Fallback: Use AI for this specific item
      const aiResult = await estimateWithAI(searchQuery);
      if (aiResult.items.length > 0) {
        items.push({ ...aiResult.items[0], source: 'ai' });
      }
    }

    // Calculate totals
    const totalCalories = items.reduce((sum, i) => sum + i.calories, 0);
    const totalProtein = items.reduce((sum, i) => sum + i.protein, 0);
    const totalCarbs = items.reduce((sum, i) => sum + i.carbs, 0);
    const totalFat = items.reduce((sum, i) => sum + i.fat, 0);

    return {
      items,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFat,
    };
  } catch (e) {
    console.error('FatSecret integration failed, using AI fallback:', e);
    return estimateWithAI(userInput, dietType);
  }
}

export function formatMealTable(parsed: ParsedFood): string {
  const lines: string[] = [];

  // Header
  lines.push('```');
  lines.push('Food                           Cal    P    C    F');
  lines.push('─'.repeat(50));

  // Items
  for (const item of parsed.items) {
    const name = item.description.substring(0, 28).padEnd(28);
    const cal = item.calories.toString().padStart(5);
    const p = (item.protein + 'g').padStart(5);
    const c = (item.carbs + 'g').padStart(5);
    const f = (item.fat + 'g').padStart(5);
    lines.push(`${name} ${cal} ${p} ${c} ${f}`);
  }

  // Total if multiple items
  if (parsed.items.length > 1) {
    lines.push('─'.repeat(50));
    const name = 'TOTAL'.padEnd(28);
    const cal = parsed.totalCalories.toString().padStart(5);
    const p = (parsed.totalProtein + 'g').padStart(5);
    const c = (parsed.totalCarbs + 'g').padStart(5);
    const f = (parsed.totalFat + 'g').padStart(5);
    lines.push(`${name} ${cal} ${p} ${c} ${f}`);
  }

  lines.push('```');
  return lines.join('\n');
}

// Simple daily summary without calorie targets
export function formatDailySummarySimple(meals: Meal[]): string {
  const totalCals = meals.reduce((sum, m) => sum + m.calories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);
  const totalCarbs = meals.reduce((sum, m) => sum + m.carbs, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.fat, 0);

  return `\n**Today:** ${totalCals} cal | ${totalProtein}g protein | ${totalCarbs}g carbs | ${totalFat}g fat`;
}

export function mealFromParsed(parsed: ParsedFood, description: string): Meal {
  return {
    description,
    calories: parsed.totalCalories,
    protein: parsed.totalProtein,
    carbs: parsed.totalCarbs,
    fat: parsed.totalFat,
    logged_at: new Date().toISOString()
  };
}
