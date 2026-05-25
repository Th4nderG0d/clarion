/** AzureRegions helpers. */
import { describe, expect, it } from 'vitest';
import { AZURE_REGIONS, AZURE_DIARIZATION_REGIONS, isKnownAzureRegion } from '../AzureRegions';

describe('AzureRegions', () => {
  it('AZURE_REGIONS contains common slugs', () => {
    expect(AZURE_REGIONS).toContain('eastus');
    expect(AZURE_REGIONS).toContain('westeurope');
    expect(AZURE_REGIONS).toContain('centralindia');
  });

  it('AZURE_DIARIZATION_REGIONS is a subset of AZURE_REGIONS', () => {
    AZURE_DIARIZATION_REGIONS.forEach(r => {
      expect(AZURE_REGIONS).toContain(r);
    });
  });

  it('isKnownAzureRegion recognises curated slugs', () => {
    expect(isKnownAzureRegion('eastus')).toBe(true);
    expect(isKnownAzureRegion('westeurope')).toBe(true);
  });

  it('isKnownAzureRegion returns false for typos / future regions', () => {
    expect(isKnownAzureRegion('eastusxyz')).toBe(false);
    expect(isKnownAzureRegion('moon-base-1')).toBe(false);
  });
});
