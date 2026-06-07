import { NextResponse } from "next/server";
import { getGoogleTrendsData } from "@/lib/dashboard-data";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request) {
  const mode = request.nextUrl.searchParams.get("mode") === "stocks" ? "stocks" : "regular";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const payload = await getGoogleTrendsData({ mode, forceRefresh });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": forceRefresh || mode === "stocks" ? "no-store" : "s-maxage=600, stale-while-revalidate=60"
    }
  });
}
