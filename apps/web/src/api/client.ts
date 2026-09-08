import type { RecipeListResponse, RecipePlanResponse } from '@abc-cook/schema'

/**
 * Base URL of the API.
 *
 * Defaults to port 8000 on whatever host served this page. That is the important case:
 * when the app is opened from a phone at `http://192.168.1.10:5173`, the API is at
 * `http://192.168.1.10:8000` — `localhost` would be the phone itself. Override with
 * `VITE_API_BASE` when the API lives elsewhere.
 */
const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`

/** A non-2xx response, carrying the status so callers can distinguish 404 from 500. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`)
  } catch {
    throw new ApiError(0, `Could not reach the API at ${API_BASE}. Is it running?`)
  }
  if (!response.ok) {
    throw new ApiError(response.status, `${path} returned ${response.status}`)
  }
  return response.json() as Promise<T>
}

/** Every recipe the API can serve, for the picker. */
export function fetchRecipes(): Promise<RecipeListResponse> {
  return getJson<RecipeListResponse>('/recipes')
}

/** A recipe's graph, its scheduled plan, and per-stage rollups. */
export function fetchPlan(recipeId: string): Promise<RecipePlanResponse> {
  return getJson<RecipePlanResponse>(`/recipes/${encodeURIComponent(recipeId)}/plan`)
}
