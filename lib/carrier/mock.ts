import type { CarrierAdapter, CarrierEvent, CarrierTracking } from "../evidence/sources";

/**
 * Deterministic carrier adapter for the demo, backed by fixtures/samples/carrier.json.
 * A real carrier (USPS/UPS APIs) implements the same CarrierAdapter interface.
 */
export interface CarrierSampleFile {
  trackings: Record<string, { carrier: string; events: CarrierEvent[] }>;
}

export class MockCarrier implements CarrierAdapter {
  constructor(private readonly data: CarrierSampleFile) {}

  async track(carrier: string, trackingNumber: string): Promise<CarrierTracking | null> {
    const t = this.data.trackings[trackingNumber];
    if (!t || t.carrier.toUpperCase() !== carrier.toUpperCase()) return null;
    return { carrier: t.carrier, trackingNumber, events: t.events };
  }
}
