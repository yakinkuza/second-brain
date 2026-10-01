import { createClient } from "@supabase/supabase-js";

// server-side only (ใช้ service key ใน API route เท่านั้น ห้าม expose ฝั่ง client)
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);
