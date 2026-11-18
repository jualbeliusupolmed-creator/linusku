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

  it('uses traveled distance rather than segment count for route progress and ETA distance', () => {
    const route: [number, number][] = [
      [0, 0],
      [0, 0.01],
      [0.001, 0.01],
    ];
    const stop = { ...USU_STOPS[0], lat: 0, lng: 0.01 };
    const projected = projectToRoute(0, 0.005, route);
    const expectedDistanceKm = haversineDistanceKm(0, 0.005, 0, 0.01);

    expect(projected.progress).toBeCloseTo(0.455, 2);
    expect(
      routeDistanceToStopKm(0, 0.005, stop, route)
    ).toBeCloseTo(expectedDistanceKm, 2);
    expect(interpolateAlongRoute(projected.progress, route).lng).toBeCloseTo(
      0.005,
      4
    );
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

  it('uses admin-configured service days and opening hours', () => {
    const settings = {
      serviceDays: [1],
      openingTime: '08:00',
      closingTime: '09:00',
      timeZone: 'Asia/Jakarta',
    };

    expect(
      getLinusOperatingStatus(new Date('2026-11-23T00:30:00.000Z'), settings).isOpen
    ).toBe(false);
    expect(
      getLinusOperatingStatus(new Date('2026-11-23T01:30:00.000Z'), settings).isOpen
    ).toBe(true);
  });
});
