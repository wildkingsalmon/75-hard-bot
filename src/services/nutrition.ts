import Anthropic from '@anthropic-ai/sdk';
import type { Meal } from '../db/schema.js';

const anthropic = new Anthropic();

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

export async function parseFoodEntry(userInput: string): Promise<ParsedFood> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Parse this food entry and estimate macros. Be accurate but reasonable - use standard USDA values when possible.

Food entry: "${userInput}"

Respond ONLY with valid JSON in this exact format:
{
  "items": [
    {
      "description": "Food item name with portion",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0
    }
  ],
  "totalCalories": 0,
  "totalProtein": 0,
  "totalCarbs": 0,
  "totalFat": 0
}

Rules:
- All macro values should be integers (round to nearest whole number)
- Use realistic portion sizes if not specified
- For restaurant food, estimate on the higher side
- Include cooking oils/butter if mentioned or implied (like "fried")
- Be specific in descriptions (e.g., "80/20 ground beef, 8oz cooked" not just "ground beef")`
      }
    ]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = content.text;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    return JSON.parse(jsonStr) as ParsedFood;
  } catch (e) {
    throw new Error(`Failed to parse food response: ${content.text}`);
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

export function formatDailySummary(
  meals: Meal[],
  calorieTarget: number,
  proteinTarget: number
): string {
  const totalCals = meals.reduce((sum, m) => sum + m.calories, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.protein, 0);
  const totalCarbs = meals.reduce((sum, m) => sum + m.carbs, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.fat, 0);

  const remainingCals = calorieTarget - totalCals;
  const remainingProtein = proteinTarget - totalProtein;

  const lines: string[] = [];
  lines.push(`\n**Today:** ${totalCals} / ${calorieTarget} cal`);

  if (remainingCals > 0) {
    lines.push(`**Remaining:** ${remainingCals} cal | Protein: ${totalProtein} / ${proteinTarget}g`);
  } else if (remainingCals === 0) {
    lines.push(`**Status:** At calorie target | Protein: ${totalProtein} / ${proteinTarget}g`);
  } else {
    lines.push(`⚠️ **OVER by ${Math.abs(remainingCals)} cal** | Protein: ${totalProtein} / ${proteinTarget}g`);
  }

  // Warning if significantly under
  if (totalCals > 0 && totalCals < calorieTarget * 0.7) {
    lines.push(`\n_Note: You're quite a bit under target. Make sure you're eating enough to sustain your workouts._`);
  }

  return lines.join('\n');
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
