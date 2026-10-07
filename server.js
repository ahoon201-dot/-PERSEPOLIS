require("dotenv").config();
const express=require("express"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const app=express();app.use(express.json());app.use(express.static(path.join(__dirname,"public")));
const PORT=Number(process.env.PORT||3000),BOT_TOKEN=process.env.BOT_TOKEN||"";
const ADMINS=new Set((process.env.ADMIN_TELEGRAM_IDS||"").split(",").map(x=>x.trim()).filter(Boolean));
const DB=path.join(__dirname,"data/db.json");
const COSTS=[500,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,8000,9000,10000,11000,12000,13000,14000,15000,16000,17000,18000,19000,20000,22000,24000,26000,28000,30000];
const SESSION=28800, BASE=.001, STEP=.00012, BASE_EN=500, EN_STEP=250;
let db=JSON.parse(fs.readFileSync(DB,"utf8"));
const save=()=>{const t=DB+".tmp";fs.writeFileSync(t,JSON.stringify(db,null,2));fs.renameSync(t,DB)};
const now=()=>Date.now(), iso=()=>new Date().toISOString();
const speed=l=>BASE+STEP*(l-1), cap=l=>BASE_EN+EN_STEP*(l-1);
function ledger(u,type,amount,note){(u.ledger||(u.ledger=[])).unshift({at:iso(),type,amount,note});u.ledger=u.ledger.slice(0,200)}
function user(id,p={}){
 let u=db.users[String(id)];
 if(!u){u={telegramId:String(id),username:p.username||"",firstName:p.firstName||"",level:1,balance:10,lifetimeMined:0,lifetimeEarned:10,lifetimeSpent:0,energy:cap(1),session:{active:false,startedAt:null,lastTick:now(),accumulated:0},referralCode:crypto.randomBytes(4).toString("hex"),referrals:[],tonAddress:"",banned:false,checkinDate:"",ledger:[]};ledger(u,"system",10,"Starter reward");db.users[u.telegramId]=u;save()}
 Object.assign(u,{username:p.username??u.username,firstName:p.firstName??u.firstName});return u;
}
function settle(u){if(!u.session.active)return;const t=now(),elapsed=Math.max(0,Math.floor((t-u.session.lastTick)/1000)),remain=Math.max(0,SESSION-Math.floor((t-u.session.startedAt)/1000)),s=Math.min(elapsed,remain);u.session.lastTick=t;u.session.accumulated+=s*speed(u.level);if(remain<=0)u.session.active=false}
function pub(u){settle(u);return {balance:+u.balance.toFixed(6),level:u.level,levelCost:u.level<30?COSTS[u.level]:null,miningSpeed:speed(u.level),energy:Math.floor(u.energy),energyCapacity:cap(u.level),mining:{active:u.session.active,startedAt:u.session.startedAt,accumulated:+u.session.accumulated.toFixed(6),remainingSec:u.session.active?Math.max(0,SESSION-Math.floor((now()-u.session.startedAt)/1000)):0},tonAddress:u.tonAddress||"",referralCode:u.referralCode}}
function auth(req){
 if(!BOT_TOKEN)return null;const raw=req.get("x-telegram-init-data")||"";if(!raw)return null;
 const q=new URLSearchParams(raw),hash=q.get("hash"),ad=Number(q.get("auth_date")||0);if(!hash||!ad||Date.now()/1000-ad>86400)return null;
 q.delete("hash");const check=[...q.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest(),exp=crypto.createHmac("sha256",secret).update(check).digest("hex");
 if(exp!==hash)return null;try{return JSON.parse(q.get("user")||"{}")}catch{return null}
}
function reqUser(req,res,next){const tg=auth(req);if(!tg?.id)return res.status(401).json({error:"Telegram authentication required"});const u=user(tg.id,{username:tg.username,firstName:tg.first_name});if(u.banned)return res.status(403).json({error:"Banned"});req.tg=tg;req.user=u;next()}
function admin(req,res,next){reqUser(req,res,()=>ADMINS.has(String(req.tg.id))?next():res.status(403).json({error:"Admin only"}))}
app.get("/api/health",(q,s)=>s.json({ok:true,project:"PERSEPOLIS"}));
app.get("/api/state",reqUser,(q,s)=>s.json({user:pub(q.user),config:{levels:30,sessionSec:SESSION,supplyTotal:1e9,gameAllocation:1e8}}));
app.post("/api/mining/start",reqUser,(q,s)=>{const u=q.user;settle(u);if(u.session.active)return s.status(400).json({error:"Already mining"});u.session={active:true,startedAt:now(),lastTick:now(),accumulated:0};save();s.json({user:pub(u)})});
app.post("/api/mining/stop",reqUser,(q,s)=>{const u=q.user;settle(u);const r=u.session.accumulated;if(r<=0&&!u.session.active)return s.status(400).json({error:"Not mining"});u.balance+=r;u.lifetimeMined+=r;u.lifetimeEarned+=r;if(r)ledger(u,"mining",r,"8-hour mining session");u.session={active:false,startedAt:null,lastTick:now(),accumulated:0};save();s.json({user:pub(u),claimed:+r.toFixed(6)})});
app.post("/api/tap",reqUser,(q,s)=>{const u=q.user;if(u.energy<5)return s.status(400).json({error:"Not enough energy"});u.energy-=5;save();s.json({user:pub(u)})});
app.post("/api/upgrade",reqUser,(q,s)=>{const u=q.user;settle(u);if(u.level>=30)return s.status(400).json({error:"Maximum level"});const c=COSTS[u.level];if(u.balance<c)return s.status(400).json({error:"Insufficient PERS"});u.balance-=c;u.lifetimeSpent+=c;u.level++;u.energy=cap(u.level);ledger(u,"upgrade",-c,"Level "+u.level);save();s.json({user:pub(u)})});
app.post("/api/claim/daily",reqUser,(q,s)=>{const u=q.user,d=new Date().toISOString().slice(0,10);if(u.checkinDate===d)return s.status(400).json({error:"Already claimed"});u.checkinDate=d;u.balance+=2;u.lifetimeEarned+=2;ledger(u,"daily",2,"Daily reward");save();s.json({user:pub(u),reward:2})});
app.get("/api/leaderboard",reqUser,(q,s)=>s.json({leaderboard:Object.values(db.users).filter(u=>!u.banned).sort((a,b)=>b.balance-a.balance).slice(0,50).map((u,i)=>({rank:i+1,name:u.firstName||u.username||"Miner",level:u.level,balance:+u.balance.toFixed(3)}))}));
app.get("/api/ledger",reqUser,(q,s)=>s.json({ledger:q.user.ledger||[]}));
app.post("/api/wallet/connect",reqUser,(q,s)=>{const a=String(q.body.address||"");if(!/^[A-Za-z0-9_-]{20,120}$/.test(a))return s.status(400).json({error:"Invalid wallet address"});q.user.tonAddress=a;save();s.json({user:pub(q.user)})});
app.post("/api/wallet/disconnect",reqUser,(q,s)=>{q.user.tonAddress="";save();s.json({user:pub(q.user)})});
app.get("/api/admin/users",admin,(q,s)=>s.json({users:Object.values(db.users).map(u=>({telegramId:u.telegramId,username:u.username,balance:u.balance,level:u.level,banned:u.banned}))}));
app.post("/api/admin/user-action",admin,(q,s)=>{const u=db.users[String(q.body.telegramId)],a=q.body.action,n=Number(q.body.amount||0);if(!u)return s.status(404).json({error:"User not found"});if(a==="grant"){u.balance+=n;u.lifetimeEarned+=n;ledger(u,"admin",n,"Admin grant")}else if(a==="deduct"){u.balance=Math.max(0,u.balance-n);ledger(u,"admin",-n,"Admin deduction")}else if(a==="ban")u.banned=true;else if(a==="unban")u.banned=false;else return s.status(400).json({error:"Unknown action"});save();s.json({user:pub(u)})});
app.post("/api/bot-webhook",(q,s)=>s.sendStatus(200));
app.listen(PORT,()=>console.log("PERSEPOLIS listening on "+PORT));
