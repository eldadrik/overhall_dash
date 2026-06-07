import { NextResponse } from "next/server";
import { getXTrendsData } from "@/lib/dashboard-data";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request) {
  const forceRefresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("refreshGrok") === "1";
  const payload = await getXTrendsData({ forceRefresh });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": forceRefresh ? "no-store" : "s-maxage=600, stale-while-revalidate=60"
    }
  });
}
