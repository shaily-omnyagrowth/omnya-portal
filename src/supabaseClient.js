import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing required Supabase environment variables. " +
      "Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in .env.local " +
      "(see .env.example) or in your Vercel project environment variables."
  );
}

export { SUPABASE_URL };
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
