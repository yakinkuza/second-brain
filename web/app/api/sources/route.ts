import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const author = req.nextUrl.searchParams.get("author");
  let q = supabaseAdmin
    .from("sources")
    .select("id,type,title,url,author,publisher,published_at,credibility,created_at")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (author) q = q.eq("author", author);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data });
}
