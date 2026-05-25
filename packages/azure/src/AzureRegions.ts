/**
 * Curated list of Azure regions where Cognitive Services Speech is generally
 * available, snapshotted from
 * https://learn.microsoft.com/azure/ai-services/speech-service/regions
 * (most recent check noted in the source comment below).
 *
 * The validator in [[validateRegion]] doesn't gate on this list — it only
 * shape-checks the slug — so a region added in the future still works.
 * This constant exists for **autocomplete in IDEs**, **type-safe pickers**,
 * and a sensible default. If your region isn't here, just pass the slug
 * as a plain string.
 */
export const AZURE_REGIONS = [
  // Americas
  'centralus',
  'eastus',
  'eastus2',
  'northcentralus',
  'southcentralus',
  'westcentralus',
  'westus',
  'westus2',
  'westus3',
  'canadacentral',
  'brazilsouth',
  // Europe
  'francecentral',
  'germanywestcentral',
  'northeurope',
  'norwayeast',
  'switzerlandnorth',
  'switzerlandwest',
  'uksouth',
  'westeurope',
  'swedencentral',
  // Asia / Pacific
  'australiaeast',
  'centralindia',
  'eastasia',
  'japaneast',
  'japanwest',
  'koreacentral',
  'southeastasia',
  // Middle East
  'qatarcentral',
  'uaenorth',
  // South Africa
  'southafricanorth',
] as const;

export type AzureRegion = (typeof AZURE_REGIONS)[number];

/**
 * Subset of regions confirmed to host the **conversation transcriber** for
 * speaker diarization at GA (en-US). Other regions may work but aren't
 * officially listed by Microsoft.
 */
export const AZURE_DIARIZATION_REGIONS = [
  'centralus',
  'eastus',
  'westeurope',
  'westus2',
] as const;

/** True when the region slug appears in the curated list. */
export const isKnownAzureRegion = (slug: string): slug is AzureRegion =>
  (AZURE_REGIONS as readonly string[]).includes(slug);
