import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("sources")
    .select("author")
    .not("author", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const names = Array.from(new Set(data.map((d) => d.author).filter(Boolean))) as string[];
  names.sort((a, b) => a.localeCompare(b, "th"));
  return NextResponse.json({ persons: names });
}
