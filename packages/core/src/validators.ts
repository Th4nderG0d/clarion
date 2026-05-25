import { ClarionError } from './errors';

/**
 * Shared pre-flight validators that every engine constructor can call before
 * any native work. Throwing `INVALID_CONFIG` at construction time gives the
 * caller a typed, actionable error before they pay for a `prepare()` round-trip.
 *
 * All validators throw `ClarionError({ code: 'INVALID_CONFIG', where: 'config-validation' })`
 * with a precise message and a friendly `userMessage`.
 */

const BCP47_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i;

/**
 * Azure publishes ~40 active speech regions. We don't ship the full table
 * here (it'd drift); instead we validate the *shape*: 3-30 lowercase letters
 * + optional digits. Real validity is confirmed at `prepare()` when the SDK
 * resolves the endpoint.
 */
const REGION_RE = /^[a-z]{3,30}[0-9]?$/;

const URL_RE = /^https?:\/\/[^\s]+$|^wss?:\/\/[^\s]+$/i;

/** Throws if `language` doesn't look like a BCP-47 tag. */
export const validateLanguage = (language: string): void => {
  const v = (language ?? '').trim();
  if (!v) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: 'language is required',
      userMessage: 'Please choose a language.',
      where: 'config-validation',
    });
  }
  if (!BCP47_RE.test(v)) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: `language "${language}" is not a BCP-47 tag (expected like "en-US", "es-MX")`,
      userMessage: 'Language code looks wrong. Use the BCP-47 format like "en-US".',
      where: 'config-validation',
      details: { provided: language },
    });
  }
};

/** Throws if `region` doesn't look like an Azure region slug (e.g. "eastus", "westeurope2"). */
export const validateRegion = (region: string): void => {
  const v = (region ?? '').trim();
  if (!v) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: 'region is required',
      userMessage: 'Please provide an Azure region.',
      where: 'config-validation',
    });
  }
  if (!REGION_RE.test(v)) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: `region "${region}" doesn't look like an Azure region slug (lowercase letters, optional digit suffix)`,
      userMessage: 'Region looks wrong. Try lowercase like "eastus" or "westeurope".',
      where: 'config-validation',
      details: { provided: region },
    });
  }
};

/** Throws if `url` isn't http(s)/ws(s). */
export const validateEndpointUrl = (url: string): void => {
  const v = (url ?? '').trim();
  if (!v) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: 'endpoint is required when provided',
      where: 'config-validation',
    });
  }
  if (!URL_RE.test(v)) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: `endpoint "${url}" is not a valid http(s) or ws(s) URL`,
      userMessage: 'Endpoint URL looks wrong.',
      where: 'config-validation',
      details: { provided: url },
    });
  }
};

export interface AzureAuthInput {
  subscriptionKey?: string;
  region?: string;
  authToken?: string;
  endpoint?: string;
}

/**
 * Verifies the caller picked exactly one valid Azure auth mode:
 *   1. subscriptionKey + region
 *   2. authToken      + region
 *   3. endpoint       (+ optional key/token)
 *
 * Throws INVALID_CONFIG when none match or when fields are blank.
 */
export const validateAzureAuthMode = (auth: AzureAuthInput): void => {
  const key = (auth.subscriptionKey ?? '').trim();
  const region = (auth.region ?? '').trim();
  const token = (auth.authToken ?? '').trim();
  const endpoint = (auth.endpoint ?? '').trim();

  const hasKey = key.length > 0 && region.length > 0;
  const hasToken = token.length > 0 && region.length > 0;
  const hasEndpoint = endpoint.length > 0;

  if (!hasKey && !hasToken && !hasEndpoint) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message:
        'Azure auth requires one of: (subscriptionKey + region), (authToken + region), or endpoint.',
      userMessage: 'Provide an Azure subscription key + region, or a custom endpoint.',
      where: 'config-validation',
    });
  }

  if (region) validateRegion(region);
  if (endpoint) validateEndpointUrl(endpoint);

  // Sanity check on key shape — Azure subscription keys are 32-char hex.
  if (key && key.length < 16) {
    throw new ClarionError({
      code: 'INVALID_CONFIG',
      message: `subscriptionKey looks too short (${key.length} chars). Azure keys are typically 32 hex characters.`,
      userMessage: 'Subscription key looks wrong.',
      where: 'config-validation',
    });
  }
};
