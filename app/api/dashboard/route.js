import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard-data";

export async function GET(request) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const payload = await getDashboardData({ forceRefresh });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "s-maxage=600, stale-while-revalidate=60"
    }
  });
}
