import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { serveSite } from "./adapter.mjs";
import { handleApi } from "./handler.mjs";

Deno.serve(serveSite(handleApi, {
  createClient,
  env: (name: string) => Deno.env.get(name),
}));
