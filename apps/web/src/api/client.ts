import type {
  ImportJobResponse,
  ImportStartResponse,
  RecipeListResponse,
  RecipePlanResponse,
} from '@abc-cook/schema'

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

/** The API's own sentence for a 4xx (`{detail: string}`, e.g. a too-short paste), else the
 * generic "path returned status" line. */
async function errorMessage(response: Response, path: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      return body.detail
    }
  } catch {
    // not JSON — fall through
  }
  return `${path} returned ${response.status}`
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, `Could not reach the API at ${API_BASE}. Is it running?`)
  }
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response, path))
  }
  return response.json() as Promise<T>
}

/** Starts an import job for a recipe URL (design doc §4.5). Returns immediately. */
export function startImport(url: string): Promise<ImportStartResponse> {
  return postJson<ImportStartResponse>('/import', { url })
}

/** Starts an import job from pasted recipe text (A8) — no acquisition on the server. */
export function startImportText(text: string): Promise<ImportStartResponse> {
  return postJson<ImportStartResponse>('/import', { text })
}

/** One poll of an import job's status. */
export function pollImport(jobId: string): Promise<ImportJobResponse> {
  return getJson<ImportJobResponse>(`/import/${encodeURIComponent(jobId)}`)
}
