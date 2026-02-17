import { createMessage } from './ai.js';
import type { Meal } from '../db/schema.js';

export type ParsedFood = {
  items: {
    description: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
};

type AIItem = {
  name: string;
  quantity: number;
  unit: string;
  per_unit: {
    cal?: number;
    calories?: number;
    p?: number;
    protein?: number;
    protein_g?: number;
    c?: number;
    carbs?: number;
    carbs_g?: number;
    carbohydrates?: number;
    f?: number;
    fat?: number;
    fat_g?: number;
  };
};

// Main function: Parse food with AI (Haiku)
export async function parseFoodEntry(userInput: string, dietType?: string): Promise<ParsedFood> {
  const dietNote = dietType
    ? `\nUser follows a ${dietType} diet.`
    : '';

  const response = await createMessage('nutrition', {
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Parse this food entry into individual items with quantities and PER-UNIT nutrition.

Food entry: "${userInput}"

Return JSON array where each item has:
- "name": food name
- "quantity": number of units
- "unit": the unit (e.g., "large", "slice", "tsp", "oz", "cup")
- "per_unit": nutrition for ONE unit (not total, not per 100g)

IMPORTANT: Return values for the ACTUAL PORTION SIZE (e.g., 1 tsp = ~5g, 1 slice bread, 1 large egg), NOT per 100g.

Respond with ONLY the JSON array, no explanation.${dietNote}`
      }
    ]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  // Extract JSON array from response
  let jsonStr = content.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || jsonStr.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1] || jsonMatch[0];
  }

  const aiItems = JSON.parse(jsonStr) as AIItem[];

  // Handle different key formats models might return
  const items: ParsedFood['items'] = aiItems.map(item => {
    const pu = item.per_unit;
    return {
      description: `${item.quantity} ${item.unit} ${item.name}`,
      calories: Math.round((pu.cal ?? pu.calories ?? 0) * item.quantity),
      protein: Math.round((pu.p ?? pu.protein ?? pu.protein_g ?? 0) * item.quantity),
      carbs: Math.round((pu.c ?? pu.carbs ?? pu.carbs_g ?? pu.carbohydrates ?? 0) * item.quantity),
      fat: Math.round((pu.f ?? pu.fat ?? pu.fat_g ?? 0) * item.quantity),
    };
  });

  return {
    items,
    totalCalories: items.reduce((sum, i) => sum + i.calories, 0),
    totalProtein: items.reduce((sum, i) => sum + i.protein, 0),
    totalCarbs: items.reduce((sum, i) => sum + i.carbs, 0),
    totalFat: items.reduce((sum, i) => sum + i.fat, 0),
  };
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
