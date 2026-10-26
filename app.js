const SB_URL="https://xrtrzhmjxmssubvwadpc.supabase.co", SB_KEY="sb_publishable_FTPunJj10iYCdEUuSk4ePQ_SqfBKzMH", DOMAIN="equipe.bfitacademias.com.br";
const sb=supabase.createClient(SB_URL,SB_KEY);
const $=s=>document.querySelector(s), app=$("#app");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>n==null?"—":Number(n).toFixed(2).replace(".",",");
const ini=n=>(n||"?").trim()[0].toUpperCase();
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("on");setTimeout(()=>t.classList.remove("on"),2600)};
const TRACK={tecnica:"Trilha Técnica · Educação Física",comercial:"Trilha Comercial",gestao:"Gestão",funcao:"Função (não é nível de carreira)"};
const STATUS={rascunho:["Rascunho","tag"],revisao:["Em revisão","tag"],enviada:["Aguardando ciência","tag rd"],ciente:["Ciente","tag ol"]};
const periodoAtual=()=>{const d=new Date();return d.getFullYear()+"-T"+(Math.floor(d.getMonth()/3)+1)};
let S={user:null,me:null,levels:[],crit:[],charts:[]};
function killCharts(){S.charts.forEach(c=>c.destroy());S.charts=[]}
Chart.defaults.color="#9c978c";Chart.defaults.font.family="Lato";Chart.defaults.borderColor="#2a2a2a";

async function boot(){
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
  const {data:{session}}=await sb.auth.getSession();
  if(!session) return loginView();
  S.user=session.user;
  const {data:me}=await sb.from("profiles").select("*").eq("id",S.user.id).single();
  if(!me){app.innerHTML=`<div class="card login"><h2>Conta sem acesso</h2><p class="mut">Peça ao Izaque para liberar seu perfil.</p><button onclick="logout()">Sair</button></div>`;return}
  S.me=me;
  if(me.must_change_password) return pwView(true);
  const [l,c]=await Promise.all([sb.from("levels").select("*").order("ordem"),sb.from("criteria").select("*").order("id")]);
  S.levels=l.data||[];S.crit=c.data||[];
  const {count}=await sb.from("assignments").select("id",{count:"exact",head:true}).eq("evaluator_id",me.id);
  const {count:sc}=await sb.from("service_contracts").select("id",{count:"exact",head:true}).eq("reviewer_id",me.id);
  const {count:rc}=await sb.from("assignments").select("id",{count:"exact",head:true}).eq("reviewer_id",me.id);
  S.isEval=me.is_admin||(count||0)>0||(sc||0)>0||(rc||0)>0;
  $("#top").hidden=false;$("#logout").onclick=logout;
  window.onhashchange=route;route();
}
async function logout(){await sb.auth.signOut();location.hash="";location.reload()}
function nav(cur){
  const it=[["#/painel","Meu painel"]];if(!S.me.fora_do_plano)it.push(["#/checklist","Checklist"]);if(S.isEval)it.push(["#/avaliar","Avaliar"]);if(S.me.is_admin||S.me.can_manage_tasks)it.push(["#/tarefas","Tarefas"]);if(S.me.is_admin)it.push(["#/admin","Admin"]);it.push(["#/senha","Senha"]);
  $("#nav").innerHTML=it.map(([h,t])=>`<a href="${h}" class="${cur.startsWith(h)?"on":""}">${t}</a>`).join("");
}
function route(){killCharts();const h=location.hash||"#/painel";nav(h);const p=h.split("/");
  if(p[1]==="avaliar"&&p[2]==="servico")return serviceView(p[3]);
  if(p[1]==="avaliar"&&p[2])return fichaView(p[2],p[3]);
  if(p[1]==="avaliar")return evalListView();
  if(p[1]==="admin")return adminView();
  if(p[1]==="tarefas")return tarefasView();
  if(p[1]==="senha")return pwView(false);
  if(p[1]==="ver")return verView(p[2]);
  if(p[1]==="checklist")return checklistView(p[2]);
  return painelView();
}

/* ---------- Login / senha ---------- */
function loginView(){
  app.innerHTML=`<form class="card login hi" id="f"><img src="logo.png" alt="B Fit"><h1>B Fit <span style="color:var(--gold)">Equipe</span></h1>
  <p class="mut sm">Plano de carreira, avaliações e evolução</p>
  <label class="t">Usuário</label><input id="u" autocomplete="username" placeholder="ex.: yasmim" required>
  <label class="t">Senha</label><input id="p" type="password" autocomplete="current-password" required>
  <p></p><button style="width:100%">Entrar</button><p class="mut sm" id="e"></p></form>`;
  $("#f").onsubmit=async e=>{e.preventDefault();$("#e").textContent="Entrando…";
    let u=$("#u").value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");if(!u.includes("@"))u+="@"+DOMAIN;
    const {error}=await sb.auth.signInWithPassword({email:u,password:$("#p").value});
    if(error){$("#e").textContent="Usuário ou senha incorretos.";return}location.reload()}
}
function pwView(force){
  app.innerHTML=`<form class="card login hi" id="f"><h2>${force?"Crie sua senha pessoal":"Trocar senha"}</h2>
  ${force?'<p class="mut sm">Primeiro acesso: troque a senha provisória.</p>':""}
  <label class="t">Nova senha (mín. 8)</label><input id="a" type="password" minlength="8" required autocomplete="new-password">
  <label class="t">Repita</label><input id="b" type="password" minlength="8" required autocomplete="new-password"><p></p><button style="width:100%">Salvar</button><p id="e" class="mut sm"></p></form>`;
  $("#f").onsubmit=async e=>{e.preventDefault();if($("#a").value!==$("#b").value){$("#e").textContent="As senhas não conferem.";return}
    const {error}=await sb.auth.updateUser({password:$("#a").value});if(error){$("#e").textContent=error.message;return}
    await sb.rpc("mark_password_changed");toast("Senha salva");if(force)location.reload();else location.hash="#/painel"}
}

/* ---------- Componentes ---------- */
function ring(val,max=5,label="nota"){
  const r=62,c=2*Math.PI*r,id="r"+Math.random().toString(36).slice(2);
  setTimeout(()=>{const el=document.getElementById(id);if(el)el.style.strokeDashoffset=c*(1-Math.min(val||0,max)/max)},60);
  return `<div class="ring"><svg width="150" height="150"><defs><linearGradient id="g${id}"><stop offset="0" stop-color="#8BA480"/><stop offset="1" stop-color="#DFA624"/></linearGradient></defs>
  <circle cx="75" cy="75" r="${r}" fill="none" stroke="#222" stroke-width="12"/><circle id="${id}" cx="75" cy="75" r="${r}" fill="none" stroke="url(#g${id})" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>
  <div class="v"><div><b>${val==null?"—":fmt(val)}</b><div class="mut sm">${label} / ${max}</div></div></div></div>`;
}
function radar(canvas,sets){
  S.charts.push(new Chart(canvas,{type:"radar",data:{labels:S.crit.map(c=>["Cultura","Técnica","Relacion.","Manutenção","Proatividade"][c.id-1]||c.nome),
   datasets:sets.map((s,i)=>({label:s.label,data:S.crit.map(c=>s.scores?.[c.id]??0),fill:true,borderColor:i?"#8BA480":"#DFA624",backgroundColor:i?"rgba(139,164,128,.15)":"rgba(223,166,36,.22)",pointBackgroundColor:i?"#8BA480":"#DFA624"}))},
   options:{animation:{duration:1400,easing:"easeOutQuart"},scales:{r:{min:0,max:5,ticks:{stepSize:1,backdropColor:"transparent"},grid:{color:"#2a2a2a"},angleLines:{color:"#2a2a2a"},pointLabels:{font:{size:11}}}},plugins:{legend:{display:sets.length>1}}}}));
}
function line(canvas,evs){
  S.charts.push(new Chart(canvas,{type:"line",data:{labels:evs.map(e=>e.periodo),datasets:[{data:evs.map(e=>e.nota_final),borderColor:"#DFA624",backgroundColor:"rgba(223,166,36,.15)",fill:true,tension:.35,pointRadius:5}]},
   options:{animation:{duration:1200},scales:{y:{min:0,max:5}},plugins:{legend:{display:false}}}}));
}
function trackLevels(track){return S.levels.filter(l=>l.track===track)}
function careerMap(a){
  if(a.track==="funcao")return `<p class="mut sm">Esta é uma função de apoio, não um nível de carreira. Sua trilha segue nas outras fichas.</p>`;
  let lv=trackLevels(a.track);if(a.function_key==="coord_comercial")lv=lv.filter(l=>l.code==="C4").concat(S.levels.filter(l=>l.code==="G3"));
  if(a.function_key==="coord_salao")lv=trackLevels("gestao");
  if(!lv.length)return "";
  const ci=lv.findIndex(l=>l.code===a.level_code);
  const steps=lv.map((l,i)=>`<div class="step ${i<ci?"done":i===ci?"cur":i===ci+1?"next":""}"><b>${l.code}</b>${esc(l.cargo)}${i===ci?'<div class="tag" style="margin-top:.3rem">você está aqui</div>':i===ci+1?'<div class="tag ol" style="margin-top:.3rem">próximo</div>':""}</div>`).join("");
  const nx=ci>=0?lv[ci+1]:lv[0];
  return `<div class="map">${steps}</div>${ci<0?'<p class="note sm">Nível atual a definir na avaliação-base com seu avaliador.</p>':""}
   ${nx?`<h3>Para chegar a ${esc(nx.code)} · ${esc(nx.cargo)}</h3><ul class="sm">${nx.reqs.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>`:""}
   ${a.function_key==="coord_comercial"?'<p class="mut sm">G3 é sugestão de horizonte (o plano não liga C4 a G3).</p>':""}`;
}

/* ---------- Meu painel ---------- */
async function painelView(pid){
  pid=pid||S.me.id;const own=pid===S.me.id;
  if(own&&S.me.fora_do_plano)return gestaoView();
  app.innerHTML='<div class="loader"></div>';
  const {data:prof}=await sb.from("profiles").select("*").eq("id",pid).single();
  const {data:as}=await sb.from("assignments").select("*,evaluator:evaluator_id(nome),reviewer:reviewer_id(nome)").eq("profile_id",pid).eq("ativo",true).order("created_at");
  const ids=(as||[]).map(a=>a.id);
  const {data:evs}=ids.length?await sb.from("evaluations").select("*").in("assignment_id",ids).in("status",["enviada","ciente"]).order("created_at"):{data:[]};
  const xp=own?(await sb.rpc("my_xp_rank")).data?.[0]:null;
  const pend=(evs||[]).filter(e=>e.status==="enviada");
  let h=`<div class="row"><div><p class="mut sm" style="margin:0">${own?"Olá,":"Painel de"}</p><h1 style="margin:0 0 1rem">${esc(prof?.nome)}</h1></div><div class="sp"></div>
   ${own?`<div class="card" style="padding:.7rem 1rem"><div class="mut sm">Meu XP da semana · posição privada</div><div class="row"><span class="kpi">${xp?.xp??0}</span><span class="tag">${xp?`${xp.posicao}º de ${xp.total}`:"—"}</span></div><a href="#/checklist" class="sm" style="color:var(--gold)">Checklist: abrir/fechar turno ›</a></div>`:""}</div>`;
  if(own&&pend.length)h+=`<div class="card hi" style="margin-bottom:1rem"><h2>📩 Você tem ${pend.length} avaliação(ões) para dar ciência</h2>${pend.map(e=>{const a=as.find(x=>x.id===e.assignment_id);return `<div class="row" style="margin:.5rem 0"><span>${esc(a?.titulo)} · ${esc(e.periodo)} · nota <b style="color:var(--gold)">${fmt(e.nota_final)}</b></span><div class="sp"></div><a href="#/ver/${e.id}"><button class="sm">Ver e dar ciência</button></a></div>`}).join("")}</div>`;
  h+=`<div class="grid">`;
  (as||[]).forEach((a,i)=>{const my=(evs||[]).filter(e=>e.assignment_id===a.id);const last=my[my.length-1];const lv=S.levels.find(l=>l.code===a.level_code);
    h+=`<div class="card ${i===0?"hi":""}" style="animation-delay:${i*.08}s"><div class="row"><span class="tag">${esc(TRACK[a.track])}</span><div class="sp"></div>${a.evaluator?`<span class="mut sm">Avaliador(a): <b>${esc(a.evaluator.nome)}</b>${a.reviewer?` · revisão: <b>${esc(a.reviewer.nome)}</b>`:""}</span>`:""}</div>
     <h2 style="margin-top:.6rem">${esc(a.titulo)}</h2><p class="mut sm" style="margin-top:-.3rem">${lv?`Nível atual: <b style="color:var(--gold)">${lv.code} · ${esc(lv.cargo)}</b>`:"Nível atual: a definir"}${a.observacao?` · ${esc(a.observacao)}`:""}</p>
     ${a.evaluator?`<div class="row" style="align-items:center">${ring(last?.nota_final)}<div class="sp" style="min-width:220px;max-width:320px"><canvas id="rd${i}"></canvas></div></div>
     ${my.length>1?`<canvas id="ln${i}" height="110"></canvas>`:`<p class="mut sm">${last?`Última avaliação: ${esc(last.periodo)} · <a href="#/ver/${last.id}" style="color:var(--gold)">abrir</a>`:"Ainda sem avaliação liberada."}</p>`}`:""}
     <h3>Mapa de carreira</h3>${careerMap(a)}</div>`});
  if(!(as||[]).length)h+=`<div class="card"><p class="mut">Nenhuma função cadastrada ainda.</p></div>`;
  app.innerHTML=h+"</div>";
  (as||[]).forEach((a,i)=>{const my=(evs||[]).filter(e=>e.assignment_id===a.id);const c=document.getElementById("rd"+i);if(c)radar(c,[{label:"Atual",scores:my[my.length-1]?.scores||{}}].concat(my.length>1?[{label:"Anterior",scores:my[my.length-2].scores}]:[]));const l=document.getElementById("ln"+i);if(l)line(l,my)});
}

/* ---------- Ver avaliação / ciência ---------- */
async function verView(id){
  const {data:e}=await sb.from("evaluations").select("*,assignment:assignment_id(*,profile:profile_id(nome),evaluator:evaluator_id(nome),reviewer:reviewer_id(nome))").eq("id",id).single();
  if(!e){app.innerHTML='<div class="card">Avaliação não encontrada.</div>';return}
  const a=e.assignment,lv=S.levels.find(l=>l.code===e.level_code),own=a.profile_id===S.me.id;
  app.innerHTML=`<a href="#/painel" class="mut sm">← voltar</a><h1>${esc(a.titulo)} · ${esc(e.periodo)}</h1>
  <div class="grid"><div class="card hi"><div class="row"><span class="${STATUS[e.status][1]}">${STATUS[e.status][0]}</span><div class="sp"></div><span class="mut sm">${esc(a.profile?.nome)} · avaliado por ${esc(a.evaluator?.nome)}${a.reviewer?` · revisão: ${esc(a.reviewer.nome)}`:""}</span></div>
   ${ring(e.nota_final,5,"nota final")}<canvas id="rd"></canvas></div>
   <div class="card"><h3>Nível</h3><p>${lv?`${lv.code} · ${esc(lv.cargo)}`:"—"} ${e.subetapa?`· sub-etapa ${e.subetapa}`:""}</p>
   ${lv?`<h3>Requisitos cumpridos</h3>${lv.reqs.map((r,i)=>`<div class="req">${(e.reqs_ok||[]).includes(i)?"✅":"⬜"} <span>${esc(r)}</span></div>`).join("")}`:""}
   <h3>Notas</h3>${S.crit.map(c=>`<div class="row sm"><span class="sp">${esc(c.nome)} (${c.peso}%)</span><b style="color:var(--gold)">${e.scores?.[c.id]??"—"}</b></div>`).join("")}
   <h3>Observações</h3><p class="sm">${esc(e.observacoes)||"—"}</p><h3>PDI · metas</h3><p class="sm" style="white-space:pre-wrap">${esc(e.pdi)||"—"}</p>
   ${revBox(e)}
   ${e.comentario_colaborador?`<h3>Comentário do colaborador</h3><p class="sm">${esc(e.comentario_colaborador)}</p>`:""}
   ${own&&e.status==="enviada"?`<label class="t">Comentário (opcional)</label><textarea id="cm"></textarea><p></p><button id="ok">Dou ciência desta avaliação</button>`:""}</div></div>`;
  radar($("#rd"),[{label:"Notas",scores:e.scores}]);
  const b=$("#ok");if(b)b.onclick=async()=>{const {error}=await sb.rpc("acknowledge_evaluation",{eval_id:id,comentario:$("#cm").value||null});if(error)return toast(error.message);toast("Ciência registrada");verView(id)};
}

function revBox(e){if(!e.revisado_em)return "";const ch=S.crit.filter(c=>e.scores_primario&&e.scores_primario[c.id]!=e.scores?.[c.id]);
  return `<h3>Revisão da 2ª etapa</h3><p class="sm">${e.revisao_concordo?"✅ Concordo":""}${e.revisao_concordo&&e.revisao_ressalvas?" · ":""}${e.revisao_ressalvas?"⚠️ Ressalvas: "+esc(e.revisao_ressalvas):""}</p>
  ${ch.length?`<p class="sm">Notas ajustadas: ${ch.map(c=>`${esc(c.nome)} ${e.scores_primario[c.id]}→<b style="color:var(--gold)">${e.scores[c.id]}</b>`).join(" · ")}</p><p class="mut sm">Justificativa: ${esc(e.revisao_justificativa)}</p>`:""}`}
/* ---------- Avaliar ---------- */
async function evalListView(){
  let q=sb.from("assignments").select("*,profile:profile_id(nome),evaluator:evaluator_id(nome),reviewer:reviewer_id(nome)").eq("ativo",true).not("evaluator_id","is",null);
  if(!S.me.is_admin)q=q.or(`evaluator_id.eq.${S.me.id},reviewer_id.eq.${S.me.id}`);
  const [{data:as},{data:sc},{data:evs}]=await Promise.all([q,sb.from("service_contracts").select("*").eq("ativo",true),sb.from("evaluations").select("id,assignment_id,status,nota_final,periodo")]);
  const groups={};(as||[]).forEach(a=>{const k=(!S.me.is_admin&&a.reviewer_id===S.me.id)?"__rev":a.evaluator?.nome||"—";(groups[k]=groups[k]||[]).push(a)});
  let h=`<h1>Avaliar</h1><p class="mut">Uma ficha por função. A nota final é calculada sozinha com os pesos 25/25/20/15/15.</p><div class="grid">`;
  const tc=(await sb.rpc("team_checklist",{desde:spDay(),ate:spDay()})).data||[];
  if(tc.length)h+=`<div class="card list"><h3>Checklist de hoje</h3>${tc.map(r=>`<a class="item" href="#/checklist/${r.profile_id}"><div class="av">${ini(r.nome)}</div><div class="sp"><b>${esc(r.nome)}</b><div class="bar" style="margin-top:.3rem"><i style="width:${r.fechado_em&&r.esperadas?Math.min(100,100*r.feitas/r.esperadas):0}%"></i></div></div><span class="mut sm">${tStatus(r)}${r.pendentes_validacao?` · <span class="tag">${r.pendentes_validacao} p/ validar</span>`:""}</span></a>`).join("")}</div>`;
  for(const [ev,list] of Object.entries(groups)){
    h+=`<div class="card list"><h3>${ev==="__rev"?"Revisar · 2ª etapa":S.me.is_admin?`Avaliador(a): ${esc(ev)}`:"Quem eu avalio"}</h3>${list.map(a=>{const e=(evs||[]).filter(x=>x.assignment_id===a.id);const last=e[e.length-1];
      return `<a class="item" href="#/avaliar/${a.id}"><div class="av">${ini(a.profile?.nome)}</div><div class="sp"><b>${esc(a.profile?.nome)}</b><div class="mut sm">${esc(a.titulo)}${a.level_code?" · "+a.level_code:""}${a.reviewer?` · avalia ${esc(a.evaluator?.nome)}, revisa ${esc(a.reviewer.nome)}`:""}</div></div>${last?`<span class="${STATUS[last.status][1]}">${fmt(last.nota_final)}</span>`:'<span class="tag rd">pendente</span>'}</a>`}).join("")}</div>`}
  if((sc||[]).length)h+=`<div class="card list"><h3>Serviço terceirizado · fora do plano</h3>${sc.map(s=>`<a class="item" href="#/avaliar/servico/${s.id}"><div class="av" style="background:var(--olive)">M</div><div class="sp"><b>${esc(s.nome)}</b><div class="mut sm">${esc(s.prestador)}</div></div></a>`).join("")}</div>`;
  app.innerHTML=h+"</div>";
}
async function fichaView(aid,eid){
  const {data:a}=await sb.from("assignments").select("*,profile:profile_id(nome)").eq("id",aid).single();
  if(!a){app.innerHTML='<div class="card">Ficha não encontrada.</div>';return}
  const {data:hist}=await sb.from("evaluations").select("*").eq("assignment_id",aid).order("created_at");
  let e=eid?(hist||[]).find(x=>x.id===eid):(hist||[]).find(x=>x.status==="rascunho");
  e=e||{periodo:periodoAtual(),level_code:a.level_code,scores:{},reqs_ok:[],status:"rascunho"};
  const rv=a.reviewer_id,isRev=rv&&(rv===S.me.id||(S.me.is_admin&&a.evaluator_id!==S.me.id))&&e.status==="revisao";
  const ro=e.status==="ciente"||(rv&&e.status!=="rascunho"&&!isRev)||(rv===S.me.id&&!isRev), roP=ro||isRev;
  let lvOpts=a.track==="funcao"?S.levels.filter(l=>l.code===a.level_code):a.function_key==="coord_comercial"?S.levels.filter(l=>["C4","G3"].includes(l.code)):trackLevels(a.track);
  if(a.track==="comercial"&&a.function_key!=="coord_comercial")lvOpts=trackLevels("comercial").filter(l=>l.code!=="C4");
  const draw=()=>{
    const lv=S.levels.find(l=>l.code===e.level_code);
    $("#reqs").innerHTML=lv?lv.reqs.map((r,i)=>`<label class="req"><input type="checkbox" data-i="${i}" ${(e.reqs_ok||[]).includes(i)?"checked":""} ${ro?"disabled":""}><span>${esc(r)}</span></label>`).join(""):'<p class="mut sm">Escolha o nível para ver os requisitos.</p>';
    document.querySelectorAll("#reqs input").forEach(x=>x.onchange=()=>{const i=+x.dataset.i;e.reqs_ok=x.checked?[...new Set([...(e.reqs_ok||[]),i])]:(e.reqs_ok||[]).filter(y=>y!==i)});
  };
  const calc=()=>{let s=0,w=0;S.crit.forEach(c=>{const v=e.scores[c.id];if(v){s+=v*c.peso;w+=c.peso}});return w?s/w:null};
  const upd=()=>{const n=calc();$("#ringbox").innerHTML=ring(n,5,w100()?"nota final":"parcial");const veto=(e.scores[1]||5)<3;$("#veto").hidden=!veto;if(S.charts[0]){S.charts[0].data.datasets[0].data=S.crit.map(c=>e.scores[c.id]||0);S.charts[0].update()}};
  const w100=()=>S.crit.every(c=>e.scores[c.id]);
  app.innerHTML=`<a href="#/avaliar" class="mut sm">← voltar</a><div class="row"><h1>${esc(a.profile?.nome)} · ${esc(a.titulo)}</h1><div class="sp"></div><span class="${STATUS[e.status][1]}">${STATUS[e.status][0]}</span></div>
  <div class="grid"><div class="card"><label class="t">Período</label><input id="per" value="${esc(e.periodo)}" ${roP?"disabled":""}>
   <label class="t">Nível atual</label><select id="lv" ${roP?"disabled":""}><option value="">— escolha —</option>${lvOpts.map(l=>`<option value="${l.code}" ${l.code===e.level_code?"selected":""}>${l.code} · ${esc(l.cargo)}</option>`).join("")}</select>
   ${a.track!=="funcao"?`<label class="t">Sub-etapa</label><select id="sub" ${roP?"disabled":""}><option value="">—</option>${["A","B","C"].map(x=>`<option ${e.subetapa===x?"selected":""}>${x}</option>`).join("")}</select>`:""}
   <h3 style="margin-top:1rem">Requisitos do nível · marque o que já cumpre</h3><div id="reqs"></div></div>
   <div class="card hi"><div id="ringbox"></div><canvas id="rd"></canvas><p id="veto" class="note sm" hidden>⚠️ Nota menor que 3 em Cultura e ética bloqueia a promoção.</p>
   <div class="scores">${S.crit.map(c=>`<div class="crit"><div class="n"><b>${esc(c.nome)}</b> <span class="tag">${c.peso}%</span><div class="mut sm">${esc(c.descricao||"")}</div></div><div class="pick" data-c="${c.id}">${[1,2,3,4,5].map(v=>`<button type="button" data-v="${v}" class="${e.scores[c.id]==v?"on":""}" ${roP?"disabled":""} data-keep>${v}</button>`).join("")}</div></div>`).join("")}</div></div>
   <div class="card"><label class="t">Observações / justificativa</label><textarea id="obs" ${roP?"disabled":""}>${esc(e.observacoes||"")}</textarea>
   <label class="t">Próximo nível combinado</label><select id="nx" ${roP?"disabled":""}><option value="">—</option>${lvOpts.map(l=>`<option value="${l.code}" ${l.code===e.proximo_nivel?"selected":""}>${l.code} · ${esc(l.cargo)}</option>`).join("")}</select>
   <label class="t">PDI · 2 ou 3 metas</label><textarea id="pdi" ${roP?"disabled":""}>${esc(e.pdi||"")}</textarea>
   ${rv&&e.scores_primario&&e.status!=="rascunho"?`<p class="note sm">Notas da avaliadora primária: ${S.crit.map(c=>e.scores_primario[c.id]).join(" · ")}</p>`:""}${revBox(e)}
   ${isRev?`<h3>Revisão · 2ª etapa</h3><label class="req"><input type="checkbox" id="rc" ${e.revisao_concordo?"checked":""}><span>Concordo com a avaliação</span></label>
   <label class="t">Ressalvas</label><textarea id="rr">${esc(e.revisao_ressalvas||"")}</textarea>
   <label class="t">Justificativa (obrigatória se ajustar notas)</label><textarea id="rj">${esc(e.revisao_justificativa||"")}</textarea>
   <p class="mut sm">Você pode ajustar as notas acima. A colaboradora só vê depois que você concluir.</p><div class="row"><button class="ghost" id="rsv">Salvar revisão</button><button id="rok">Concluir revisão e liberar</button></div>`
   :e.status==="revisao"?`<p class="note sm">Enviada. Aguardando a revisão de 2ª etapa; a colaboradora ainda não vê.</p>`
   :e.status==="enviada"&&rv?`<p class="note sm">Revisada e liberada para ciência.</p>`
   :e.status==="ciente"?`<p class="note sm">Colaborador(a) deu ciência em ${new Date(e.ciente_em).toLocaleDateString("pt-BR")}. ${esc(e.comentario_colaborador||"")}</p>`:ro?"":`<p></p><div class="row"><button class="ghost" id="sv">Salvar rascunho</button><button id="send">${rv?"Enviar para revisão":"Enviar para ciência"}</button></div>`}
   <h3 style="margin-top:1.2rem">Histórico</h3>${(hist||[]).map(x=>`<div class="row sm"><a href="#/avaliar/${aid}/${x.id}" style="color:var(--txt)">${esc(x.periodo)}</a><span class="${STATUS[x.status][1]}">${STATUS[x.status][0]}</span><div class="sp"></div><b style="color:var(--gold)">${fmt(x.nota_final)}</b></div>`).join("")||'<p class="mut sm">Primeira avaliação.</p>'}</div></div>`;
  radar($("#rd"),[{label:"Notas",scores:e.scores}]);draw();upd();
  $("#lv").onchange=x=>{e.level_code=x.target.value||null;e.reqs_ok=[];draw()};
  document.querySelectorAll(".pick").forEach(p=>p.onclick=ev=>{const b=ev.target.closest("button");if(!b||ro)return;e.scores[p.dataset.c]=+b.dataset.v;p.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));upd()});
  const save=async st=>{
    if(st==="enviada"&&!w100())return toast("Dê nota nos 5 critérios antes de enviar");
    if(isRev){const row={scores:e.scores,revisao_concordo:$("#rc").checked,revisao_ressalvas:$("#rr").value.trim()||null,revisao_justificativa:$("#rj").value.trim()||null,status:st};
      if(st==="enviada"&&!row.revisao_concordo&&!row.revisao_ressalvas)return toast("Marque Concordo e/ou escreva ressalvas");
      if(st==="enviada"&&S.crit.some(c=>e.scores_primario?.[c.id]!=e.scores[c.id])&&!row.revisao_justificativa)return toast("Justifique o ajuste de notas");
      const r=await sb.from("evaluations").update(row).eq("id",e.id).select().single();if(r.error)return toast(r.error.message);
      toast(st==="enviada"?"Revisão concluída · liberada ✅":"Revisão salva");return fichaView(aid,e.id)}
    const row={assignment_id:aid,periodo:$("#per").value.trim()||periodoAtual(),level_code:e.level_code||null,subetapa:$("#sub")?.value||null,scores:e.scores,reqs_ok:e.reqs_ok||[],observacoes:$("#obs").value,pdi:$("#pdi").value,proximo_nivel:$("#nx").value||null,status:st};
    const r=e.id?await sb.from("evaluations").update(row).eq("id",e.id).select().single():await sb.from("evaluations").insert({...row,evaluator_id:S.me.id}).select().single();
    if(r.error)return toast(r.error.message);
    if(st==="enviada"&&e.level_code&&S.me.is_admin&&e.level_code!==a.level_code)await sb.from("assignments").update({level_code:e.level_code}).eq("id",aid);
    toast(st==="enviada"?(rv?"Enviada para revisão ✅":"Enviada para ciência ✅"):"Rascunho salvo");location.hash=`#/avaliar/${aid}/${r.data.id}`;if(e.id)fichaView(aid,r.data.id)};
  if(isRev){$("#rsv").onclick=()=>save("revisao");$("#rok").onclick=()=>save("enviada")}
  else if(!ro){$("#sv").onclick=()=>save("rascunho");$("#send").onclick=()=>save("enviada")}
}
async function serviceView(cid){
  const [{data:s},{data:hist}]=await Promise.all([sb.from("service_contracts").select("*").eq("id",cid).single(),sb.from("service_reviews").select("*").eq("contract_id",cid).order("created_at")]);
  if(!s){app.innerHTML='<div class="card">Não encontrado.</div>';return}
  const K=[["entregas","Entregas","O que foi combinado foi entregue"],["prazos","Prazos","Entregas no prazo combinado"],["qualidade","Qualidade","Acabamento, revisão e clareza"],["marca","Alinhamento à marca","Tom, valores e identidade B Fit"],["resultados","Resultados","Alcance, contatos e matrículas geradas"]];
  let r=(hist||[]).find(x=>x.status==="rascunho")||{periodo:periodoAtual(),scores:{},entregas:[{},{},{}]};
  const avg=()=>{const v=K.map(k=>r.scores[k[0]]).filter(Boolean);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  app.innerHTML=`<a href="#/avaliar" class="mut sm">← voltar</a><h1>${esc(s.nome)}</h1><p class="note sm"><b>Fora do plano de carreira.</b> Serviço terceirizado prestado por ${esc(s.prestador)}. Não gera nível, nota de carreira nem promoção.</p>
  <div class="grid" style="margin-top:1rem"><div class="card hi"><div id="rb"></div>${K.map(k=>`<div class="crit" style="margin-top:.5rem"><div class="n"><b>${k[1]}</b><div class="mut sm">${k[2]}</div></div><div class="pick" data-k="${k[0]}">${[1,2,3,4,5].map(v=>`<button type="button" data-v="${v}" class="${r.scores[k[0]]==v?"on":""}">${v}</button>`).join("")}</div></div>`).join("")}</div>
  <div class="card"><label class="t">Período</label><input id="per" value="${esc(r.periodo)}"><h3 style="margin-top:1rem">Entregas do período</h3>
  <table><tr><th>Demanda</th><th>Prazo</th><th>Status</th></tr>${(r.entregas.length?r.entregas:[{}]).map((x,i)=>`<tr><td><input data-i="${i}" data-f="demanda" value="${esc(x.demanda||"")}"></td><td><input data-i="${i}" data-f="prazo" value="${esc(x.prazo||"")}"></td><td><select data-i="${i}" data-f="status"><option></option><option ${x.status==="OK"?"selected":""}>OK</option><option ${x.status==="Ajustar"?"selected":""}>Ajustar</option></select></td></tr>`).join("")}</table>
  <label class="t">Decisão</label><select id="dec">${["","Manter como está","Ajustar combinados","Rever o serviço com o Izaque"].map(o=>`<option ${r.decisao===o?"selected":""}>${o}</option>`).join("")}</select>
  <label class="t">Ajustes combinados</label><textarea id="aj">${esc(r.ajustes||"")}</textarea><label class="t">Próximas demandas</label><textarea id="px">${esc(r.proximas||"")}</textarea><p></p>
  <div class="row"><button class="ghost" id="sv">Salvar rascunho</button><button id="send">Concluir</button></div>
  <h3 style="margin-top:1rem">Histórico</h3>${(hist||[]).map(x=>`<div class="row sm"><span>${esc(x.periodo)}</span><span class="tag">${x.status}</span></div>`).join("")||'<p class="mut sm">—</p>'}</div></div>`;
  const u=()=>$("#rb").innerHTML=ring(avg(),5,"média");u();
  document.querySelectorAll(".pick").forEach(p=>p.onclick=ev=>{const b=ev.target.closest("button");if(!b)return;r.scores[p.dataset.k]=+b.dataset.v;p.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));u()});
  const save=async st=>{const ent=[];document.querySelectorAll("[data-f]").forEach(x=>{const i=+x.dataset.i;ent[i]=ent[i]||{};ent[i][x.dataset.f]=x.value});
    const row={contract_id:cid,periodo:$("#per").value,scores:r.scores,entregas:ent.filter(x=>x.demanda),decisao:$("#dec").value,ajustes:$("#aj").value,proximas:$("#px").value,status:st};
    const q=r.id?await sb.from("service_reviews").update(row).eq("id",r.id):await sb.from("service_reviews").insert({...row,reviewer_id:S.me.id});
    if(q.error)return toast(q.error.message);toast("Salvo");serviceView(cid)};
  $("#sv").onclick=()=>save("rascunho");$("#send").onclick=()=>save("enviada");
}

/* ---------- Admin ---------- */
async function adminView(){
  if(!S.me.is_admin){location.hash="#/painel";return}
  const [{data:ps},{data:as},{data:evs},{data:ts}]=await Promise.all([sb.from("profiles").select("*").order("nome"),sb.from("assignments").select("*").order("created_at"),sb.from("evaluations").select("assignment_id,nota_final,status,periodo"),sb.from("task_templates").select("*").order("function_key").order("ordem")]);
  const pn=id=>ps.find(p=>p.id===id)?.nome||"—";
  const done=(evs||[]).filter(e=>e.status==="enviada"||e.status==="ciente");
  const avgBy=ps.filter(p=>as.some(a=>a.profile_id===p.id&&a.evaluator_id)).map(p=>{const ids=as.filter(a=>a.profile_id===p.id).map(a=>a.id);const n=done.filter(e=>ids.includes(e.assignment_id)).map(e=>+e.nota_final);return {p,n:n.length?n.reduce((a,b)=>a+b,0)/n.length:0}});
  const evAs=as.filter(a=>a.evaluator_id);const pendentes=evAs.filter(a=>!done.some(e=>e.assignment_id===a.id)).length;
  app.innerHTML=`<h1>Painel do administrador</h1>
  <div class="grid"><div class="card hi"><div class="mut sm">Equipe</div><div class="kpi">${ps.length}</div></div><div class="card"><div class="mut sm">Fichas (uma por função)</div><div class="kpi">${evAs.length}</div></div>
  <div class="card"><div class="mut sm">Fichas sem avaliação</div><div class="kpi">${pendentes}</div><div class="bar"><i id="pb"></i></div></div><div class="card"><div class="mut sm">Aguardando ciência</div><div class="kpi">${(evs||[]).filter(e=>e.status==="enviada").length}</div></div></div>
  <div class="card" style="margin-top:1rem"><h2>Nota média por pessoa</h2><canvas id="bars" height="90"></canvas></div>
  <div class="card" style="margin-top:1rem"><div class="row"><h2>Pessoas</h2><div class="sp"></div><button class="sm" id="nu">+ Nova pessoa</button></div><div id="nf"></div>
   <table><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th></th></tr>${ps.map(p=>`<tr><td><a href="#" data-pv="${p.id}" style="color:var(--gold)">${esc(p.nome)}</a></td><td>${esc(p.usuario)}</td><td>${p.is_admin?'<span class="tag">admin</span>':""} ${p.must_change_password?'<span class="tag rd">senha provisória</span>':""} ${p.ativo?"":'<span class="tag rd">inativo</span>'}</td><td><button class="ghost sm" data-rp="${p.id}">Redefinir senha</button></td></tr>`).join("")}</table></div>
  <div class="card" style="margin-top:1rem"><div class="row"><h2>Funções e avaliadores</h2><div class="sp"></div><button class="sm" id="na">+ Nova função</button></div>
   <table><tr><th>Pessoa</th><th>Função</th><th>Nível</th><th>Avaliador(a)</th><th>Revisão</th><th>Ativa</th><th></th></tr>${as.map(a=>`<tr data-a="${a.id}"><td>${esc(pn(a.profile_id))}</td><td><input data-k="titulo" value="${esc(a.titulo)}"><div class="mut sm">${a.function_key} · ${a.track}</div></td>
   <td><select data-k="level_code"><option value="">—</option>${S.levels.map(l=>`<option value="${l.code}" ${l.code===a.level_code?"selected":""}>${l.code} · ${esc(l.cargo)}</option>`).join("")}</select></td>
   <td><select data-k="evaluator_id"><option value="">—</option>${ps.map(p=>`<option value="${p.id}" ${p.id===a.evaluator_id?"selected":""}>${esc(p.nome)}</option>`).join("")}</select></td><td><select data-k="reviewer_id"><option value="">—</option>${ps.map(p=>`<option value="${p.id}" ${p.id===a.reviewer_id?"selected":""}>${esc(p.nome)}</option>`).join("")}</select></td><td><input type="checkbox" data-k="ativo" ${a.ativo?"checked":""} style="width:auto"></td><td><button class="sm" data-sa="${a.id}">Salvar</button></td></tr>`).join("")}</table></div>
  <div class="card" style="margin-top:1rem"><div class="row"><h2>Tarefas diárias</h2><div class="sp"></div><a href="#/tarefas"><button class="sm">Gerenciar tarefas</button></a></div></div>`;
  setTimeout(()=>{const b=$("#pb");if(b)b.style.width=(evAs.length?100*(evAs.length-pendentes)/evAs.length:0)+"%"},80);
  S.charts.push(new Chart($("#bars"),{type:"bar",data:{labels:avgBy.map(x=>x.p.nome),datasets:[{data:avgBy.map(x=>x.n),backgroundColor:avgBy.map((x,i)=>i%2?"#8BA480":"#DFA624"),borderRadius:8}]},options:{animation:{duration:1300},scales:{y:{min:0,max:5}},plugins:{legend:{display:false}}}}));
  document.querySelectorAll("[data-pv]").forEach(x=>x.onclick=ev=>{ev.preventDefault();killCharts();painelView(x.dataset.pv)});
  document.querySelectorAll("[data-sa]").forEach(b=>b.onclick=async()=>{const tr=b.closest("tr"),row={};tr.querySelectorAll("[data-k]").forEach(i=>row[i.dataset.k]=i.type==="checkbox"?i.checked:(i.value||null));
    const {error}=await sb.from("assignments").update(row).eq("id",b.dataset.sa);toast(error?error.message:"Função salva")});
  const fn=async body=>{const {data:{session}}=await sb.auth.getSession();const r=await fetch(SB_URL+"/functions/v1/admin-users",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});return r.json()};
  document.querySelectorAll("[data-rp]").forEach(b=>b.onclick=async()=>{const s=prompt("Nova senha provisória (mín. 8 caracteres):");if(!s)return;const r=await fn({action:"reset_password",id:b.dataset.rp,senha:s});toast(r.error||"Senha redefinida; troca obrigatória no próximo acesso")});
  $("#nu").onclick=()=>{$("#nf").innerHTML=`<div class="grid" style="margin:.5rem 0"><input id="n1" placeholder="Nome"><input id="n2" placeholder="usuário (ex.: ana)"><input id="n3" placeholder="Senha provisória (mín. 8)"><button id="n4">Criar</button></div>`;
    $("#n4").onclick=async()=>{const r=await fn({action:"create_user",nome:$("#n1").value,usuario:$("#n2").value,senha:$("#n3").value});if(r.error)return toast(r.error);toast("Pessoa criada");adminView()}};
  $("#na").onclick=async()=>{const p=prompt("Usuário da pessoa (ex.: veronica):");if(!p)return;const pr=ps.find(x=>x.usuario===p.trim().toLowerCase());if(!pr)return toast("Usuário não encontrado");
    const t=prompt("Nome da função:");if(!t)return;const tr=prompt("Trilha: tecnica, comercial, gestao ou funcao","tecnica");if(!TRACK[tr])return toast("Trilha inválida");
    const {error}=await sb.from("assignments").insert({profile_id:pr.id,titulo:t,track:tr,function_key:tr==="tecnica"?"edfisica":tr==="comercial"?"comercial":tr});toast(error?error.message:"Função criada");adminView()};
}

/* ---------- Gestão de tarefas ---------- */
const FUNCS={edfisica:"Estagiário(a) de Ed. Física",professor:"Professor(a)",coord_salao:"Coordenação do Salão",coord_comercial:"Coordenação Comercial",recepcao:"Recepção",administrativo:"Auxiliar Administrativa"};
const TST={rascunho:["Aguardando aprovação","tag"],aprovada:["Aprovada","tag ol"],arquivada:["Retirada","tag rd"]};
async function tarefasView(){
  if(!(S.me.is_admin||S.me.can_manage_tasks)){location.hash="#/painel";return}
  const {data:ts,error}=await sb.from("task_templates").select("*").order("function_key").order("ordem");
  if(error){app.innerHTML=`<div class="card">${esc(error.message)}</div>`;return}
  const f=S.tf||"todas",st=S.ts||"ativas";
  const list=ts.filter(t=>(f==="todas"||t.function_key===f)&&(st==="todas"||(st==="ativas"?t.status!=="arquivada":t.status===st)));
  const cnt=k=>ts.filter(t=>t.status===k).length;
  const opt=(o,v)=>Object.entries(o).map(([k,l])=>`<option value="${k}" ${k===v?"selected":""}>${esc(l)}</option>`).join("");
  app.innerHTML=`<h1>Tarefas diárias</h1><p class="mut">Inserir, editar, aprovar ou retirar tarefas. Retirar não apaga: o histórico dos checklists fica preservado.</p>
  <div class="grid"><div class="card hi"><div class="mut sm">Aprovadas</div><div class="kpi">${cnt("aprovada")}</div></div><div class="card"><div class="mut sm">Aguardando aprovação</div><div class="kpi">${cnt("rascunho")}</div></div><div class="card"><div class="mut sm">Retiradas</div><div class="kpi">${cnt("arquivada")}</div></div></div>
  <div class="card" style="margin-top:1rem"><h2>Nova tarefa</h2><div class="grid"><select id="nf">${opt(FUNCS,f==="todas"?"edfisica":f)}</select><input id="nt" placeholder="Descrição da tarefa"><input id="nx" type="number" min="1" max="100" value="10" placeholder="XP"><button id="nb">Inserir</button></div></div>
  <div class="card" style="margin-top:1rem"><div class="row"><h2>Lista</h2><div class="sp"></div><select id="ff" style="width:auto">${opt({todas:"Todas as funções",...FUNCS},f)}</select><select id="fs" style="width:auto">${opt({ativas:"Ativas",rascunho:"Aguardando aprovação",aprovada:"Aprovadas",arquivada:"Retiradas",todas:"Todas"},st)}</select>
  ${cnt("rascunho")?`<button class="sm" id="all">Aprovar todas pendentes${f!=="todas"?" desta função":""}</button>`:""}</div>
  <table><tr><th>Função</th><th>Tarefa</th><th>XP</th><th>Status</th><th></th></tr>${list.map(t=>`<tr data-id="${t.id}"><td><select data-k="function_key">${opt(FUNCS,t.function_key)}</select></td><td><input data-k="titulo" value="${esc(t.titulo)}"></td><td style="width:80px"><input data-k="xp" type="number" min="1" max="100" value="${t.xp}"></td>
   <td><span class="${TST[t.status][1]}">${TST[t.status][0]}</span></td><td class="row" style="flex-wrap:nowrap"><button class="sm ghost" data-a="save">Salvar</button>${t.status!=="aprovada"?'<button class="sm" data-a="aprovada">Aprovar</button>':""}${t.status!=="arquivada"?'<button class="sm ghost" data-a="arquivada">Retirar</button>':'<button class="sm ghost" data-a="rascunho">Reativar</button>'}</td></tr>`).join("")||'<tr><td colspan="5" class="mut">Nenhuma tarefa neste filtro.</td></tr>'}</table></div>`;
  $("#ff").onchange=e=>{S.tf=e.target.value;tarefasView()};$("#fs").onchange=e=>{S.ts=e.target.value;tarefasView()};
  $("#nb").onclick=async()=>{const t=$("#nt").value.trim();if(!t)return toast("Escreva a tarefa");const fk=$("#nf").value;
    const {error}=await sb.from("task_templates").insert({function_key:fk,titulo:t,xp:+$("#nx").value||10,ordem:ts.filter(x=>x.function_key===fk).length,status:"rascunho"});toast(error?error.message:"Tarefa inserida (aguardando aprovação)");tarefasView()};
  const al=$("#all");if(al)al.onclick=async()=>{if(!confirm("Aprovar todas as tarefas pendentes"+(f!=="todas"?" desta função":"")+"?"))return;let q=sb.from("task_templates").update({status:"aprovada"}).eq("status","rascunho");if(f!=="todas")q=q.eq("function_key",f);const {error}=await q;toast(error?error.message:"Tarefas aprovadas");tarefasView()};
  document.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{const tr=b.closest("tr"),row={};tr.querySelectorAll("[data-k]").forEach(i=>row[i.dataset.k]=i.dataset.k==="xp"?+i.value:i.value.trim());
    if(!row.titulo)return toast("A tarefa não pode ficar vazia");if(b.dataset.a!=="save"){if(b.dataset.a==="arquivada"&&!confirm("Retirar esta tarefa? O histórico fica preservado."))return;row.status=b.dataset.a}
    const {error}=await sb.from("task_templates").update(row).eq("id",tr.dataset.id);toast(error?error.message:({save:"Tarefa salva",aprovada:"Tarefa aprovada ✅",arquivada:"Tarefa retirada",rascunho:"Tarefa reativada (aguardando aprovação)"})[b.dataset.a]);tarefasView()});
}

/* ---------- Visão de gestão (Izaque / sócia) ---------- */
async function gestaoView(){
  app.innerHTML='<div class="loader"></div>';
  const adm=S.me.is_admin;
  let q=sb.from("assignments").select("*").eq("ativo",true).not("evaluator_id","is",null);if(!adm)q=q.eq("evaluator_id",S.me.id);
  const [{data:as},{data:ps},{data:evs},tq]=await Promise.all([q,sb.from("profiles").select("id,nome,fora_do_plano,ativo").order("nome"),sb.from("evaluations").select("assignment_id,nota_final,status,periodo,created_at").order("created_at"),
    (adm||S.me.can_manage_tasks)?sb.from("task_templates").select("id",{count:"exact",head:true}).eq("status","rascunho"):Promise.resolve({count:null})]);
  const pn=id=>ps.find(p=>p.id===id)?.nome||"—";
  const team=ps.filter(p=>p.ativo&&!p.fora_do_plano&&as.some(a=>a.profile_id===p.id));
  const lastOf=a=>{const e=evs.filter(x=>x.assignment_id===a.id&&(x.status==="enviada"||x.status==="ciente"));return e[e.length-1]};
  const emRev=evs.filter(e=>e.status==="revisao"&&as.some(a=>a.id===e.assignment_id));
  const semAval=as.filter(a=>!lastOf(a)&&!emRev.some(e=>e.assignment_id===a.id)),aguard=evs.filter(e=>e.status==="enviada"&&as.some(a=>a.id===e.assignment_id));
  const avg=p=>{const n=as.filter(a=>a.profile_id===p.id).map(lastOf).filter(Boolean).map(e=>+e.nota_final);return n.length?n.reduce((x,y)=>x+y,0)/n.length:null};
  const avaliadas=as.length-semAval.length;
  let h=`<p class="mut sm" style="margin:0">${adm?"Sócio-fundador · Responsável Técnico · Administrador":"Sócia · avalia o administrativo (Verônica e Marcelly)"}</p><h1 style="margin:.1rem 0 1rem">${esc(S.me.nome)}</h1>
  <div class="kpis"><div class="card hi"><div class="mut sm">Equipe</div><div class="kpi" data-n="${team.length}">0</div></div>
   <div class="card"><div class="mut sm">Fichas avaliadas</div><div class="kpi"><span data-n="${avaliadas}">0</span><span class="mut" style="font-size:1rem"> / ${as.length}</span></div><div class="bar"><i data-w="${as.length?100*avaliadas/as.length:0}"></i></div></div>
   <div class="card"><div class="mut sm">Aguardando ciência</div><div class="kpi" data-n="${aguard.length}">0</div></div>
   ${tq.count!=null?`<a href="#/tarefas" class="card" style="color:inherit;text-decoration:none"><div class="mut sm">Tarefas p/ aprovar ›</div><div class="kpi" data-n="${tq.count}">0</div></a>`:`<div class="card"><div class="mut sm">Sem avaliação</div><div class="kpi" data-n="${semAval.length}">0</div></div>`}</div>
  <div class="card" style="margin-top:1rem"><h2>Notas da equipe</h2><p class="mut sm" style="margin-top:-.4rem">Média das últimas avaliações liberadas, por pessoa</p><div style="position:relative;height:${Math.max(160,team.length*44)}px"><canvas id="gb"></canvas></div></div>`;
  if(semAval.length||aguard.length||emRev.length)h+=`<div class="card" style="margin-top:1rem"><h2>Pendências</h2>${emRev.map(e=>{const a=as.find(x=>x.id===e.assignment_id);return `<a class="pend" href="#/avaliar/${a.id}/${e.id}"><span class="tag">revisão</span><span class="sp">${esc(pn(a.profile_id))} · ${esc(a.titulo)}</span><span class="mut sm">${esc(pn(a.reviewer_id).split(" ")[0])} ›</span></a>`}).join("")}${aguard.map(e=>{const a=as.find(x=>x.id===e.assignment_id);return `<div class="pend"><span class="tag rd">ciência</span><span class="sp">${esc(pn(a.profile_id))} · ${esc(a.titulo)}</span><b style="color:var(--gold)">${fmt(e.nota_final)}</b></div>`}).join("")}
   ${semAval.map(a=>`<a class="pend" href="#/avaliar/${a.id}"><span class="tag">avaliar</span><span class="sp">${esc(pn(a.profile_id))} · ${esc(a.titulo)}</span><span class="mut sm">${esc(pn(a.evaluator_id).split(" ")[0])}${a.reviewer_id?" → "+esc(pn(a.reviewer_id).split(" ")[0]):""} ›</span></a>`).join("")}</div>`;
  const wk=weekDays(),tcl=(await sb.rpc("team_checklist",{desde:wk[0],ate:spDay()})).data||[];
  const tPeople=[...new Map(tcl.map(r=>[r.profile_id,r.nome])).entries()];
  const tStat=pid=>{const rs=tcl.filter(r=>r.profile_id===pid),hj=rs.find(r=>r.data===spDay())||{feitas:0,esperadas:0,pendentes_validacao:0};const f=rs.reduce((a,r)=>a+(r.fechado_em?+r.feitas:0),0),e=rs.reduce((a,r)=>a+ +r.esperadas,0);return {hj,sem:e?100*f/e:0,xp:rs.reduce((a,r)=>a+ +r.xp,0),pv:rs.reduce((a,r)=>a+ +r.pendentes_validacao,0)}};
  if(tPeople.length)h+=`<div class="card" style="margin-top:1rem"><h2>Checklist da equipe</h2><p class="mut sm" style="margin-top:-.4rem">Status do turno hoje e semana (seg→hoje, só dias fechados)</p>
   ${tPeople.map(([pid,nome])=>{const t=tStat(pid),pd=t.hj.fechado_em&&t.hj.esperadas?Math.min(100,100*t.hj.feitas/t.hj.esperadas):0;return `<a class="pend" href="#/checklist/${pid}" style="display:block"><div class="row"><b class="sp">${esc(nome)}</b><span class="mut sm">${tStatus(t.hj)} · semana ${Math.round(t.sem)}%${t.pv?` · <span class="tag">${t.pv} p/ validar</span>`:""} ›</span></div><div class="bar" style="margin-top:.35rem"><i data-w="${pd}"></i></div></a>`}).join("")}
   <div style="position:relative;height:${Math.max(160,tPeople.length*40)}px;margin-top:.8rem"><canvas id="gw"></canvas></div></div>`;
  h+=`<h2 style="margin:1.4rem 0 .6rem">Pessoas</h2><div class="grid">${team.map((p,i)=>{const m=avg(p);return `<div class="card pcard" style="animation-delay:${i*.06}s" ${adm?`data-pv="${p.id}"`:""}>
   <div class="row"><div class="av">${ini(p.nome)}</div><b class="sp" style="font:800 1.05rem Montserrat">${esc(p.nome)}</b><span class="kpi" style="font-size:1.3rem">${fmt(m)}</span></div>
   ${as.filter(a=>a.profile_id===p.id).map(a=>{const e=lastOf(a),lv=S.levels.find(l=>l.code===a.level_code);return `<div class="fn"><div class="row"><b class="sp sm">${esc(a.titulo)}</b>${e?`<span class="${STATUS[e.status][1]}">${fmt(e.nota_final)}</span>`:'<span class="tag rd">sem nota</span>'}</div>
     <div class="mut sm">${a.track==="funcao"?"Função de apoio":lv?`${lv.code} · ${esc(lv.cargo)}`:"Nível a definir"} · avalia: ${esc(pn(a.evaluator_id).split(" ")[0])}${a.reviewer_id?` · revisa: ${esc(pn(a.reviewer_id).split(" ")[0])}`:""}</div></div>`}).join("")}
   ${adm?'<div class="mut sm" style="text-align:right;margin-top:.4rem">ver painel ›</div>':""}</div>`}).join("")}</div>`;
  app.innerHTML=h;
  document.querySelectorAll("[data-n]").forEach(el=>{const n=+el.dataset.n,t0=performance.now();const f=t=>{const k=Math.min(1,(t-t0)/900);el.textContent=Math.round(n*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(f)};requestAnimationFrame(f)});
  setTimeout(()=>document.querySelectorAll("[data-w]").forEach(el=>el.style.width=el.dataset.w+"%"),80);
  const vals=team.map(avg);
  S.charts.push(new Chart($("#gb"),{type:"bar",data:{labels:team.map(p=>p.nome),datasets:[{data:vals.map(v=>v??0),backgroundColor:vals.map(v=>v==null?"#333":v>=4?"#8BA480":"#DFA624"),borderRadius:8,barThickness:22}]},
   options:{indexAxis:"y",maintainAspectRatio:false,animation:{duration:1400,easing:"easeOutQuart"},scales:{x:{min:0,max:5,ticks:{stepSize:1}},y:{grid:{display:false}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>vals[c.dataIndex]==null?"sem avaliação":"nota "+fmt(vals[c.dataIndex])}}}}}));
  document.querySelectorAll("[data-pv]").forEach(x=>x.onclick=()=>{killCharts();painelView(x.dataset.pv)});
  if($("#gw"))S.charts.push(new Chart($("#gw"),{type:"bar",data:{labels:tPeople.map(x=>x[1]),datasets:[{label:"Semana %",data:tPeople.map(x=>Math.round(tStat(x[0]).sem)),backgroundColor:"#DFA624",borderRadius:8,barThickness:18}]},options:{indexAxis:"y",maintainAspectRatio:false,animation:{duration:1400,easing:"easeOutQuart"},scales:{x:{min:0,max:100,ticks:{callback:v=>v+"%"}},y:{grid:{display:false}}},plugins:{legend:{display:false},title:{display:true,text:"Cumprimento da semana (%)"}}}}));
}

/* ---------- Fase 2 · Checklist diário ---------- */
const spDay=(d=new Date())=>d.toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"});
const addDays=(ds,n)=>{const d=new Date(ds+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const weekDays=()=>{const t=spDay(),w=(new Date(t+"T12:00:00Z").getUTCDay()+6)%7;return Array.from({length:7},(_,i)=>addDays(t,i-w))};
const tStatus=r=>!r.aberto_em?"não iniciado":!r.fechado_em?`em turno desde ${hm(r.aberto_em)}`:`fechado às ${hm(r.fechado_em)} · ${r.feitas}/${r.esperadas}`;
const DOW=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
function pring(pct,big,small){const r=62,c=2*Math.PI*r,id="p"+Math.random().toString(36).slice(2);
  setTimeout(()=>{const el=document.getElementById(id);if(el)el.style.strokeDashoffset=c*(1-Math.min(pct,100)/100)},60);
  return `<div class="ring"><svg width="150" height="150"><defs><linearGradient id="g${id}"><stop offset="0" stop-color="#8BA480"/><stop offset="1" stop-color="#DFA624"/></linearGradient></defs><circle cx="75" cy="75" r="${r}" fill="none" stroke="#222" stroke-width="12"/><circle id="${id}" cx="75" cy="75" r="${r}" fill="none" stroke="url(#g${id})" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg><div class="v"><div><b>${big}</b><div class="mut sm">${small}</div></div></div></div>`}
const hm=t=>t?new Date(t).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}):"";
async function checklistView(pid,mode){
  pid=pid||S.me.id;const own=pid===S.me.id;
  if(own&&S.me.fora_do_plano)return gestaoView();
  app.innerHTML='<div class="loader"></div>';
  const today=spDay(),from=addDays(today,-60);
  const [{data:prof},{data:as}]=await Promise.all([sb.from("profiles").select("id,nome").eq("id",pid).single(),sb.from("assignments").select("id,function_key,titulo").eq("profile_id",pid).eq("ativo",true)]);
  const fks=[...new Set((as||[]).map(a=>a.function_key))];
  const [{data:ts},{data:en},{data:dys},xr]=await Promise.all([fks.length?sb.from("task_templates").select("*").eq("status","aprovada").in("function_key",fks).order("ordem"):{data:[]},
    sb.from("checklist_entries").select("*").eq("profile_id",pid).gte("data",from).order("created_at"),sb.from("checklist_days").select("*").eq("profile_id",pid).gte("data",from),own?sb.rpc("my_xp_rank"):Promise.resolve({data:null})]);
  const E=en||[],T=ts||[],D=dys||[],exp=T.length;
  const closed=d=>D.some(k=>k.data===d&&k.fechado_em);
  const xp=e=>(closed(e.data)&&(e.tipo==="obrigatoria"||e.validado_por))?e.xp:0;
  const day=d=>E.filter(e=>e.data===d),done=d=>day(d).filter(e=>e.tipo==="obrigatoria").length;
  const met=d=>closed(d)&&(exp?done(d)>=Math.ceil(exp/2):true);
  let streak=0,d0=met(today)?today:addDays(today,-1);while(met(d0)&&streak<61){streak++;d0=addDays(d0,-1)}
  // turno atual: hoje, ou ontem ainda aberto (virou a meia-noite)
  const cur=D.find(k=>k.data===today)||D.find(k=>k.data===addDays(today,-1)&&!k.fechado_em);
  const st=!cur?"novo":cur.fechado_em?"fechado":"aberto",cd=cur?.data||today;
  if(own&&mode==="fechar"&&st!=="aberto")mode=null;
  const hj=day(cd),feitas=done(cd),xpHoje=hj.reduce((a,e)=>a+xp(e),0);
  const wk=weekDays(),xpW=wk.map(d=>day(d).reduce((a,e)=>a+xp(e),0));
  const xpTot=E.reduce((a,e)=>a+xp(e),0),pv=E.filter(e=>e.tipo==="proativa"&&e.validado_por).length;
  const ach=[["🚀","Primeiro passo","1º checklist concluído",D.some(k=>k.fechado_em)],["⏱️","Turno completo","Abriu e fechou o turno",D.some(k=>k.aberto_em&&k.fechado_em)],["💯","Dia perfeito","100% das tarefas num dia fechado",exp>0&&D.some(k=>k.fechado_em&&done(k.data)>=exp)],
    ["🔥","Sequência de 3","3 dias fechados seguidos",streak>=3],["🏆","Semana de ferro","7 dias fechados seguidos",streak>=7],["💡","Proativo(a)","3 proatividades validadas",pv>=3],["⭐","500 XP","500 XP em 60 dias",xpTot>=500]];
  const byF={};T.forEach(t=>(byF[t.function_key]=byF[t.function_key]||[]).push(t));
  const fname=k=>(as||[]).find(a=>a.function_key===k)?.titulo||FUNCS[k]||k;
  const xr0=xr.data?.[0];
  const sel=S.sel&&S.sel.pid===pid&&S.sel.d===cd?S.sel:(S.sel={pid,d:cd,t:new Set(),p:[]});
  const closing=own&&mode==="fechar";
  const stTxt=st==="novo"?"Turno não iniciado":st==="aberto"?`Em turno desde ${hm(cur.aberto_em)}`:`Turno ${hm(cur.aberto_em)} → ${hm(cur.fechado_em)} · concluído`;
  const pct=exp?100*(closing?sel.t.size:feitas)/exp:0;
  let h=`${own?"":`<a href="javascript:history.back()" class="mut sm">← voltar</a>`}<p class="mut sm" style="margin:0">${own?"Checklist":"Checklist de"} · ${new Date(cd+"T12:00:00Z").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"})}</p><h1 style="margin:.1rem 0 .4rem">${esc(prof?.nome)}</h1>
  <p style="margin:0 0 1rem"><span class="tag ${st==="fechado"?"ol":st==="aberto"?"":"rd"}">${stTxt}</span></p>`;
  if(own&&st==="novo")h+=`<div class="card hi turno"><div class="ti">☀️</div><h2>Abertura do turno</h2><p class="mut">Veja as ${exp} tarefas de hoje e comece o trabalho.</p><button id="ini" class="big">Iniciar turno</button></div>`;
  if(own&&st==="aberto"&&!closing)h+=`<div class="card hi turno"><div class="ti">📵</div><h2>Bom trabalho!</h2><p>Guarde o celular e foque no atendimento. Volte <b>no fim do turno</b> para fechar o checklist.</p><button id="fch" class="big">Fechar turno</button></div>`;
  h+=`<div class="card ckhero" style="margin-top:1rem"><div>${pring(pct,`${closing?sel.t.size:st==="fechado"||!own?feitas:0}/${exp}`,closing?"marcadas":st==="fechado"?"concluídas":"tarefas do dia")}</div><div class="ckstats">
   <div><span class="mut sm">XP do dia</span><b class="kpi" data-n="${xpHoje}">0</b></div><div><span class="mut sm">Sequência</span><b class="kpi">🔥 <span data-n="${streak}">0</span></b><span class="mut sm">dia(s) fechados</span></div>
   ${own?`<div><span class="mut sm">XP da semana · posição privada</span><b class="kpi" data-n="${xr0?.xp??0}">0</b><span class="tag">${xr0?`${xr0.posicao}º de ${xr0.total}`:"—"}</span></div>`:""}</div></div>`;
  if(closing)h+=`<div class="card hi" style="margin-top:1rem"><h2>🌙 Fechamento do turno</h2><p class="mut sm" style="margin:0">Marque o que você concluiu hoje. Nada é gravado até você tocar em <b>Concluir checklist</b>.</p></div>`;
  if(!exp)h+=`<div class="card" style="margin-top:1rem"><p class="mut">Ainda não há tarefas aprovadas para ${own?"sua função":"esta função"}.</p></div>`;
  for(const [k,list] of Object.entries(byF)){const isOk=t=>closing?sel.t.has(t.id):hj.some(e=>e.template_id===t.id);
   h+=`<div class="card" style="margin-top:1rem"><div class="row"><h2 class="sp" style="margin:0">${esc(fname(k))}</h2><span class="mut sm">${(st==="fechado"||closing||!own)?list.filter(isOk).length+"/":""}${list.length}</span></div>
   ${list.map(t=>{const ok=isOk(t);return `<button type="button" class="task ${ok?"ok":""} ${closing?"":"ro"}" data-t="${t.id}" ${closing?"":"disabled"}><span class="chk">${ok?"✓":closing?"":"•"}</span><span class="sp">${esc(t.titulo)}</span><span class="xp">+${t.xp} XP</span></button>`}).join("")}</div>`}
  const pro=E.filter(e=>e.tipo==="proativa"&&(own?e.data===cd:e.data>=addDays(today,-7))).reverse();
  if(closing||pro.length||!own)h+=`<div class="card" style="margin-top:1rem"><h2>💡 Proatividade</h2><p class="mut sm" style="margin-top:-.4rem">+10 XP cada, após validação de quem te avalia</p>
   ${closing?`<div class="row" style="flex-wrap:nowrap"><input id="pt" placeholder="O que você fez além do combinado?"><button id="pb2" class="ghost">Adicionar</button></div>${sel.p.map((x,i)=>`<div class="pend"><span class="tag">nova</span><span class="sp sm">${esc(x)}</span><button class="sm ghost" data-rm="${i}">✕</button></div>`).join("")}`:""}
   ${pro.map(e=>`<div class="pend"><span class="${e.validado_por?"tag ol":"tag"}">${e.validado_por?"validada":"aguardando"}</span><span class="sp sm">${esc(e.descricao)}${own?"":` <span class="mut">· ${e.data.split("-").reverse().slice(0,2).join("/")}</span>`}</span>${!own?`<button class="sm ${e.validado_por?"ghost":""}" data-v="${e.id}" data-on="${e.validado_por?0:1}">${e.validado_por?"Desfazer":"Validar"}</button>`:""}</div>`).join("")||(closing?"":'<p class="mut sm">Nenhuma nos últimos 7 dias.</p>')}</div>`;
  if(closing){const xpSel=T.filter(t=>sel.t.has(t.id)).reduce((a,t)=>a+t.xp,0);
    h+=`<div class="card hi" style="margin-top:1rem"><h2>Revisão</h2><p>${sel.t.size} de ${exp} tarefas · <b style="color:var(--gold)">+${xpSel} XP</b>${sel.p.length?` · ${sel.p.length} proatividade(s)`:""}</p><p class="note sm">Depois de concluir, o dia fica travado.</p><div class="row"><button class="ghost" id="cx">Voltar</button><button id="ok" class="big sp">Concluir checklist</button></div></div>`}
  if(own&&st==="fechado")h+=`<div class="card hi turno" style="margin-top:1rem"><div class="ti">✅</div><h2>Checklist concluído</h2><p class="mut">${feitas} de ${exp} tarefas · fechado às ${hm(cur.fechado_em)}. Até amanhã!</p></div>`;
  h+=`<div class="card" style="margin-top:1rem"><h2>Semana</h2><div style="position:relative;height:190px"><canvas id="wk"></canvas></div></div>
  <div class="card" style="margin-top:1rem"><h2>Conquistas</h2><div class="achs">${ach.map(([i,n,d,ok])=>`<div class="ach ${ok?"on":""}"><div class="ai">${i}</div><b>${n}</b><span class="mut sm">${d}</span></div>`).join("")}</div></div>`;
  app.innerHTML=h;
  document.querySelectorAll("[data-n]").forEach(el=>{const n=+el.dataset.n,t0=performance.now();const f=t=>{const k=Math.min(1,(t-t0)/900);el.textContent=Math.round(n*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(f)};requestAnimationFrame(f)});
  S.charts.push(new Chart($("#wk"),{type:"bar",data:{labels:DOW,datasets:[{data:xpW,backgroundColor:wk.map(d=>d===today?"#DFA624":"#8BA480"),borderRadius:8}]},options:{maintainAspectRatio:false,animation:{duration:1200,easing:"easeOutQuart"},scales:{y:{beginAtZero:true,title:{display:true,text:"XP (dias fechados)"}}},plugins:{legend:{display:false}}}}));
  if(own){
    const ini=$("#ini");if(ini)ini.onclick=async()=>{ini.disabled=true;const {error}=await sb.rpc("iniciar_turno");if(error){ini.disabled=false;return toast(error.message)}toast("Turno iniciado · bom trabalho!");checklistView()};
    const fc=$("#fch");if(fc)fc.onclick=()=>{killCharts();checklistView(null,"fechar");scrollTo(0,0)};
    if(closing){
      const refresh=()=>{const n=sel.t.size,x=T.filter(t=>sel.t.has(t.id)).reduce((a,t)=>a+t.xp,0);const rv=[...document.querySelectorAll(".card.hi h2")].find(e=>e.textContent==="Revisão");if(rv)rv.nextElementSibling.innerHTML=`${n} de ${exp} tarefas · <b style="color:var(--gold)">+${x} XP</b>${sel.p.length?` · ${sel.p.length} proatividade(s)`:""}`;const rb=document.querySelector(".ckhero .ring b");if(rb)rb.textContent=`${n}/${exp}`;const c=document.querySelector(".ckhero circle[id]");if(c){const L=2*Math.PI*62;c.style.strokeDashoffset=L*(1-(exp?n/exp:0))}};
      document.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{const id=b.dataset.t;sel.t.has(id)?sel.t.delete(id):sel.t.add(id);const on=sel.t.has(id);b.classList.toggle("ok",on);if(on)b.classList.add("pop");b.querySelector(".chk").textContent=on?"✓":"";refresh()});
      $("#pb2").onclick=()=>{const t=$("#pt").value.trim();if(!t)return toast("Descreva o que você fez");sel.p.push(t);killCharts();checklistView(null,"fechar")};
      document.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{sel.p.splice(+b.dataset.rm,1);killCharts();checklistView(null,"fechar")});
      $("#cx").onclick=()=>{killCharts();checklistView()};
      $("#ok").onclick=async()=>{const t=$("#pt").value.trim();if(t)sel.p.push(t);if(!sel.t.size&&!confirm("Nenhuma tarefa marcada. Concluir mesmo assim?"))return;if(!confirm(`Concluir com ${sel.t.size} de ${exp} tarefas? O dia ficará travado.`))return;
        $("#ok").disabled=true;const {error}=await sb.rpc("fechar_turno",{tarefas:[...sel.t],proativas:sel.p});if(error){$("#ok").disabled=false;return toast(error.message)}
        S.sel=null;toast(sel.t.size>=exp&&exp?"💯 Dia perfeito! Checklist concluído":"✅ Checklist concluído");killCharts();checklistView();scrollTo(0,0)};
    }
  } else document.querySelectorAll("[data-v]").forEach(b=>b.onclick=async()=>{const on=b.dataset.on==="1";const {error}=await sb.from("checklist_entries").update({validado_por:on?S.me.id:null}).eq("id",b.dataset.v);toast(error?error.message:on?"Validada · +10 XP":"Validação desfeita");checklistView(pid)});
}
boot();
