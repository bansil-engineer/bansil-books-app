import { NextRequest, NextResponse } from 'next/server';
import { UniversalSearchService } from '../../lib/search/universal-search-service.ts';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q || q.trim() === '') {
    return NextResponse.json({ results: [] });
  }

  const service = new UniversalSearchService();
  const results = service.searchUniversal(q);

  return NextResponse.json({ results });
}
