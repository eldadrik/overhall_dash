import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard-data";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const refreshGrok = request.nextUrl.searchParams.get("refreshGrok") === "1";
  const payload = await getDashboardData({ forceRefresh, refreshGrok });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "s-maxage=600, stale-while-revalidate=60"
    }
  });
}
