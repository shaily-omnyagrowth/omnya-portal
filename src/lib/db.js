import { supabase } from "../supabaseClient";

// WRITES THAT SAY WHEN THEY DID NOT HAPPEN
// ============================================================
//
// `await supabase.from(t).update(patch).eq("id", id)` cannot fail loudly on
// its own. It RESOLVES in all three of these cases, and the old call sites
// read none of them:
//
//   * an `error` comes back (unknown column, CHECK violation, a trigger's
//     RAISE) -- it is a field on the result, not a throw;
//   * RLS filters the row out -- no error at all, just zero rows updated;
//   * it worked.
//
// So the UI flipped its checkbox, showed the new number, and the next reload
// put the old one back. That is the whole of "commission fields are not
// editable" and "sales source does not persist": one missing check, repeated
// at every call site. Asking for the row back (.select) is what turns the RLS
// case from silence into a countable zero.
//
// Returns null on success, or a sentence fit to show the user.
export const MIGRATION_HINT = "The database is missing a column this screen needs. Apply the pending migration (supabase/migrations/20260918000000_creator_portal_fixes.sql), then retry.";

export function describeWriteError(error) {
  if (!error) return null;
  if (error.code === "PGRST204" || error.code === "42703") return MIGRATION_HINT;
  if (error.code === "42501") return error.message || "You do not have permission to change that.";
  if (error.code === "23514") return "That value is not allowed here. " + (error.message || "");
  return error.message || "The change could not be saved.";
}

// Demo video attached to a campaign application. Same bucket and the same
// `submissions/<campaign>/` prefix the Submit Content screen already writes to,
// so it rides on whatever storage policy lets creators upload there today
// rather than needing a new one. 200 MB is a guard against a phone's raw 4K
// export, not a product decision.
const DEMO_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export async function uploadDemoVideo(file, campaignId, creatorName) {
  if (!file) return null;
  if (file.type && !file.type.startsWith("video/")) throw new Error("Please choose a video file.");
  if (file.size > DEMO_VIDEO_MAX_BYTES) throw new Error("That file is over 200 MB. Trim it, or paste a link instead.");
  const safe = `${creatorName || "creator"}_demo_${file.name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `submissions/${campaignId}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from("submissions").upload(filePath, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from("submissions").getPublicUrl(filePath).data.publicUrl;
}

export async function updateRows(table, patch, match) {
  const { data, error } = await supabase.from(table).update(patch).match(match).select();
  if (error) return describeWriteError(error);
  if (!data || data.length === 0) return "Nothing was saved \u2014 you may not have permission to change this.";
  return null;
}

//
// A failed table read is not automatically a broken schema, and the two cases
// need very different handling.
//
//   - A genuinely absent relation/column reports a schema code (42P01, 42703,
//     or PostgREST's own PGRST205 for an unknown table). That means migrations
//     have not been applied and only the owner can fix it.
//   - A session that simply was not ready yet reports 401 / PGRST301 on a
//     refreshing JWT, or a 5xx on a cold start. loadDB runs off `user`, and
//     `user` is replaced with a fresh object on every SIGNED_IN and
//     TOKEN_REFRESHED, so the first pass can easily race ahead of the token.
//     These recover on their own within a second.
//   - An RLS denial is not an error at all: PostgREST returns an empty array.
//     Nothing here ever sees it.
//
// Escalating the second group to "your database is not set up" is what put a
// schema-setup modal in front of creators signing up. Retry once, and only
// alarm the user if the retry fails too.
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST205"]);

export function isSchemaError(error) {
  return SCHEMA_ERROR_CODES.has(error?.code);
}

export async function selectAllWithRetry(tableName, { retries = 1, delayMs = 600 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.from(tableName).select("*");
    if (!error) return { data: data || [], error: null };
    // A missing table will still be missing in 600ms — don't stall the load.
    if (attempt >= retries || isSchemaError(error)) return { data: null, error };
    console.warn(`Transient error loading ${tableName} (${error.code || "no code"}): ${error.message} — retrying`);
    await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
  }
}
