import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const DOMAIN = "equipe.bfitacademias.com.br";
const BOOT_HASH = "<hash>";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
async function sha(t: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const norm = (u: string) => u.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._-]/g, "");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: any; try { body = await req.json(); } catch { return j({ error: "JSON inválido" }, 400); }
  async function create(u: any) {
    const usuario = norm(u.usuario);
    if (!usuario || !u.nome || !u.senha || String(u.senha).length < 8) throw new Error("Nome, usuário e senha (mín. 8) são obrigatórios");
    const { data, error } = await admin.auth.admin.createUser({ email: usuario + "@" + DOMAIN, password: u.senha, email_confirm: true, user_metadata: { nome: u.nome } });
    if (error) throw error;
    const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, nome: u.nome, usuario, is_admin: !!u.is_admin, must_change_password: true });
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); throw e2; }
    return { id: data.user.id, usuario };
  }
  try {
    if (body.action === "bootstrap") {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
      if ((count ?? 0) > 0) return j({ error: "Bootstrap desativado" }, 403);
      if ((await sha(String(body.token || ""))) !== BOOT_HASH) return j({ error: "Token inválido" }, 403);
      const out = []; for (const u of body.users || []) out.push(await create(u));
      return j({ ok: true, users: out });
    }
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !ud?.user) return j({ error: "Não autenticado" }, 401);
    const { data: me } = await admin.from("profiles").select("is_admin").eq("id", ud.user.id).single();
    if (!me?.is_admin) return j({ error: "Apenas o administrador" }, 403);
    if (body.action === "create_user") return j({ ok: true, user: await create(body) });
    if (body.action === "reset_password") {
      if (!body.id || String(body.senha || "").length < 8) return j({ error: "Senha mín. 8" }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.senha }); if (error) throw error;
      await admin.from("profiles").update({ must_change_password: true }).eq("id", body.id);
      return j({ ok: true });
    }
    if (body.action === "set_active") {
      await admin.auth.admin.updateUserById(body.id, { ban_duration: body.ativo ? "none" : "876000h" });
      await admin.from("profiles").update({ ativo: !!body.ativo }).eq("id", body.id);
      return j({ ok: true });
    }
    return j({ error: "Ação desconhecida" }, 400);
  } catch (e) { return j({ error: (e as Error).message }, 400); }
});
