import { NextResponse } from 'next/server';
import { getCampusRoadPolyline } from '@/lib/campusRoute';

export async function GET() {
  const route = await getCampusRoadPolyline();
  return NextResponse.json(route, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
