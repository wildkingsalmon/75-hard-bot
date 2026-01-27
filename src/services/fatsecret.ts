// FatSecret API integration for accurate nutrition data

const OAUTH_URL = 'https://oauth.fatsecret.com/connect/token';
const API_URL = 'https://platform.fatsecret.com/rest/server.api';

let cachedToken: { token: string; expiresAt: number } | null = null;

// Get OAuth2 access token
async function getAccessToken(): Promise<string> {
  const clientId = process.env.FATSECRET_CLIENT_ID;
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FatSecret credentials not configured');
  }

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  });

  if (!response.ok) {
    throw new Error(`FatSecret auth failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return cachedToken.token;
}

// Search for foods
export type FoodSearchResult = {
  food_id: string;
  food_name: string;
  food_description: string; // Contains serving info and macros
  brand_name?: string;
};

export async function searchFoods(query: string, maxResults = 5): Promise<FoodSearchResult[]> {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    method: 'foods.search',
    search_expression: query,
    format: 'json',
    max_results: String(maxResults),
  });

  const response = await fetch(`${API_URL}?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`FatSecret search failed: ${response.status}`);
  }

  const data = await response.json() as {
    foods?: { food: FoodSearchResult | FoodSearchResult[] };
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`FatSecret error: ${data.error.message}`);
  }

  if (!data.foods?.food) {
    return [];
  }

  // API returns single object if only one result, array if multiple
  const foods = Array.isArray(data.foods.food) ? data.foods.food : [data.foods.food];
  return foods;
}

// Get detailed nutrition for a specific food
export type FoodNutrition = {
  food_id: string;
  food_name: string;
  servings: {
    serving: ServingInfo | ServingInfo[];
  };
};

export type ServingInfo = {
  serving_description: string;
  serving_url: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  calories: string;
  protein: string;
  carbohydrate: string;
  fat: string;
  fiber?: string;
  sugar?: string;
  sodium?: string;
};

export async function getFoodDetails(foodId: string): Promise<FoodNutrition | null> {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    method: 'food.get.v4',
    food_id: foodId,
    format: 'json',
  });

  const response = await fetch(`${API_URL}?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`FatSecret get failed: ${response.status}`);
  }

  const data = await response.json() as {
    food?: FoodNutrition;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`FatSecret error: ${data.error.message}`);
  }

  return data.food || null;
}

// Parse the food_description string from search results
// Format: "Per 100g - Calories: 149kcal | Fat: 10.98g | Carbs: 0.77g | Protein: 10.25g"
export function parseDescription(description: string): {
  serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} | null {
  try {
    const servingMatch = description.match(/^(Per [^-]+)/i) || description.match(/^([^-]+)/);
    const serving = servingMatch ? servingMatch[1].trim() : 'Per serving';

    const calMatch = description.match(/Calories:\s*([\d.]+)/i);
    const fatMatch = description.match(/Fat:\s*([\d.]+)/i);
    const carbMatch = description.match(/Carbs:\s*([\d.]+)/i);
    const proteinMatch = description.match(/Protein:\s*([\d.]+)/i);

    if (!calMatch) return null;

    return {
      serving,
      calories: Math.round(parseFloat(calMatch[1])),
      protein: proteinMatch ? Math.round(parseFloat(proteinMatch[1])) : 0,
      carbs: carbMatch ? Math.round(parseFloat(carbMatch[1])) : 0,
      fat: fatMatch ? Math.round(parseFloat(fatMatch[1])) : 0,
    };
  } catch {
    return null;
  }
}

// Check if FatSecret is configured
export function isConfigured(): boolean {
  return !!(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET);
}
