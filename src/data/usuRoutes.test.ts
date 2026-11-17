import { describe, expect, it } from 'vitest';
import {
  estimateEtaMinutes,
  haversineDistanceKm,
  interpolateAlongRoute,
  isInsideCampus,
  findNearestStop,
  getLinusOperatingStatus,
  projectToRoute,
  routeDistanceToStopKm,
  USU_STOPS,
} from './usuRoutes';

describe('USU route utilities', () => {
  it('rejects coordinates outside the configured campus bounds', () => {
    expect(isInsideCampus(3.5625, 98.6562)).toBe(true);
    expect(isInsideCampus(-6.2, 106.8)).toBe(false);
    expect(isInsideCampus(Number.NaN, 98.6562)).toBe(false);
  });

  it('calculates a positive Haversine distance', () => {
    expect(
      haversineDistanceKm(3.5656, 98.6594, 3.5639, 98.6578)
    ).toBeGreaterThan(0);
  });

  it('wraps route interpolation at the route boundary', () => {
    expect(interpolateAlongRoute(-0.1)).toEqual(interpolateAlongRoute(0.9));
  });

  it('projects a location onto the route', () => {
    const projected = projectToRoute(3.5625, 98.6562);
    expect(projected.distanceKm).toBeLessThan(1);
    expect(projected.progress).toBeGreaterThanOrEqual(0);
    expect(projected.progress).toBeLessThanOrEqual(1);
  });

  it('computes forward route distance along the campus loop', () => {
    const firstStop = USU_STOPS[0];
    const nextStop = USU_STOPS[1];
    const distKm = routeDistanceToStopKm(firstStop.lat, firstStop.lng, nextStop);
    expect(distKm).toBeGreaterThan(0);
    expect(distKm).toBeLessThan(5);
  });

  it('returns a bounded ETA', () => {
    const eta = estimateEtaMinutes(
      { lat: 3.5656, lng: 98.6594, speedKmh: 18 },
      USU_STOPS[9]
    );
    expect(eta).toBeGreaterThanOrEqual(1);
  });

  it('finds the nearest registered stop', () => {
    const result = findNearestStop(3.5656, 98.6594);
    expect(result.stop.id).toBe('halte-pintu-1');
    expect(result.distanceMeters).toBeGreaterThanOrEqual(0);
  });

  it('marks weekdays outside 07.00 to 17.00 as closed', () => {
    const sunday = new Date('2026-11-22T03:00:00.000Z');
    expect(getLinusOperatingStatus(sunday).isOpen).toBe(false);
  });
});
