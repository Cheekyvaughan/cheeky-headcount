import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ── Mobile detection ──────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 640);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// ── Storage shim ──────────────────────────────────────────────────
if (!window.storage) {
  window.storage = {
    get: async (key) => { const v = localStorage.getItem(key); return v ? { value: v } : null; },
    set: async (key, value) => { localStorage.setItem(key, value); return { key, value }; },
    checkAndSet: async (key, value) => { localStorage.setItem(key, value); return { ok: true }; },
  };
}

// ── Brand ─────────────────────────────────────────────────────────
const CN = {
  orange: "#F43A0A", orangeHover: "#D4320A", orangeLight: "#FDE8E2",
  cream: "#FAF4E4", creamDark: "#F0E8D0", dark: "#1C1208", mid: "#7A6A58",
  border: "#E0D4BC", white: "#FFFFFF", amber: "#F59E0B", amberLight: "#FEF3C7",
  amberDark: "#D97706", red: "#DC2626", redLight: "#FEE2E2",
  blue: "#2563EB", blueLight: "#DBEAFE", purple: "#7C3AED", purpleLight: "#EDE9FE",
  green: "#16A34A", greenLight: "#DCFCE7",
};

// ── Defaults ──────────────────────────────────────────────────────
// Per-year tax template — clone and adjust when adding a new year
function defaultTaxForYear(year) {
  return {
    federalSS: 6.2, federalMedicare: 1.45, futa: 0.6,
    waSUI: 1.2, waLnI: 1.85, waPFML: 0,
    ssWageBase: 176100, suiWageBase: 72800,
    minWage: 16.66, nonExemptWeeklyMin: 1332.80,
    effectiveDate: `Jan 1, ${year}`,
    finalized: false,
  };
}
// Backward-compat single-year object (used in migration)
const DEFAULT_TAX = defaultTaxForYear(new Date().getFullYear());
const DEFAULT_OT = { weeklyThreshold: 40, dailyMax: 10, multiplier: 1.5, nonExemptWeeklyMin: 1332.80 };
const DEFAULT_TAB_ICONS = { roles: "👥", plan: "📋", summary: "📊" };
const DEFAULT_BENEFITS = { healthMonthly: 0, dentalMonthly: 0, visionMonthly: 0, retirement401k: 0, otherMonthly: 0 };

const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const CATEGORIES = ["BOH","FOH","Management","Other"];
const PAY_TYPES = ["Hourly","Salary"];
const MAX_SCENARIOS = 10;

// Storage keys — v5 introduces scenario model
// Per-user storage keys (scoped by Clerk userId)
function userSK(userId) {
  return {
    roleScenarios: `cn-hc-role-scenarios-v1-${userId}`,
    planScenarios: `cn-hc-plan-scenarios-v1-${userId}`,
    // Legacy migration keys (no userId — shared, old versions)
    sharedRoleScenarios: "cn-hc-role-scenarios-v1",
    sharedPlanScenarios: "cn-hc-plan-scenarios-v1",
    legacyRoles: "cn-hc-roles-v4",
    legacyPlans: "cn-hc-plans-v4",
  };
}
// Shared keys (all users)
const SHARED_SK = {
  taxYears: "cn-hc-tax-years-v1",  // per-year tax map { [year]: taxObject }
  tax: "cn-hc-tax-v3",             // kept for one-time migration only
  ot: "cn-hc-ot-v4",
  logo: "cn-hc-logo-v1",
  icons: "cn-hc-tab-icons-v1",
  userRegistry: "cn-hc-user-registry-v1",
  admins: "cn-hc-admins-v1",
};

function uid() { return Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
function isoMonday(d) { return d.toISOString().split("T")[0]; }
function toMonday(date) {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate() + (day===0?-6:1-day)); d.setHours(0,0,0,0); return d;
}
function fmtWeek(dateStr) {
  const d = new Date(dateStr+"T00:00:00"), end = new Date(d);
  end.setDate(end.getDate()+6);
  const o = {month:"short",day:"numeric"};
  return `${d.toLocaleDateString("en-US",o)} – ${end.toLocaleDateString("en-US",{...o,year:"numeric"})}`;
}
function fmt$(n) { return "$"+(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,","); }
function fmtK(n) { return Math.abs(n)>=1000?"$"+(n/1000).toFixed(1)+"k":fmt$(n); }
function emptyDays() { return DAYS.reduce((a,d)=>({...a,[d]:""}),{}); }
function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

const DEFAULT_ROLES = [
  {id:uid(),name:"Line Cook",        category:"BOH",        payType:"Hourly",rate:18,  defaultHours:35,otEligible:true, exempt:false,benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Prep / Dishwasher",category:"BOH",        payType:"Hourly",rate:16,  defaultHours:30,otEligible:true, exempt:false,benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Counter / Cashier",category:"FOH",        payType:"Hourly",rate:16,  defaultHours:30,otEligible:true, exempt:false,benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Delivery Runner",  category:"FOH",        payType:"Hourly",rate:15,  defaultHours:20,otEligible:true, exempt:false,benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Manager",          category:"Management", payType:"Salary",rate:4500,defaultHours:45,otEligible:false,exempt:true, benefits:{...DEFAULT_BENEFITS,healthMonthly:300},active:true},
];

function makeRoleScenario(name, roles, isDefault = false) {
  return { id: uid(), name, roles: deepClone(roles), isDefault };
}
function makePlanScenario(name, roleScenarioId, isDefault = false) {
  return { id: uid(), name, roleScenarioId, plans: [], isDefault };
}

// ── Cost calculation ──────────────────────────────────────────────
// Salary + exempt:    weekly cost = salary/4.33, no OT ever
// Salary + nonexempt: weekly cost = salary/4.33 + half-time OT premium
//                     derived hourly = (salary/4.33) / weeklyThreshold
//                     OT premium = derivedHourly * (multiplier-1) * otHrs
// Hourly:             normal OT calc
function calcRowCost(role, dayHours, tax, ot) {
  const T = tax||DEFAULT_TAX, O = ot||DEFAULT_OT;
  const totalHrs = DAYS.reduce((s,d)=>s+(parseFloat(dayHours[d])||0),0);
  let wages=0, otPremium=0, otHrs=0;

  if (role.payType==="Hourly") {
    const reg = Math.min(totalHrs, O.weeklyThreshold);
    otHrs = role.otEligible ? Math.max(0, totalHrs - O.weeklyThreshold) : 0;
    wages = reg*role.rate + otHrs*role.rate*O.multiplier;
    otPremium = otHrs*role.rate*(O.multiplier-1);
  } else {
    // Salary
    const weeklyRate = role.rate / 4.33;
    if (role.exempt) {
      wages = weeklyRate; // Never changes regardless of hours
    } else {
      // Nonexempt salaried: salary covers all straight time, add half-time for OT
      const derivedHourly = weeklyRate / O.weeklyThreshold;
      otHrs = Math.max(0, totalHrs - O.weeklyThreshold);
      otPremium = derivedHourly * (O.multiplier - 1) * otHrs;
      wages = weeklyRate + otPremium;
    }
  }

  const tb = {
    ss: wages*(T.federalSS/100), medicare: wages*(T.federalMedicare/100),
    futa: wages*(T.futa/100), sui: wages*(T.waSUI/100),
    lni: totalHrs*(T.waLnI||0), pfml: wages*(T.waPFML/100),
  };
  const taxes = Object.values(tb).reduce((s,v)=>s+v,0);
  const b = role.benefits||DEFAULT_BENEFITS;
  const monthly = (b.healthMonthly||0)+(b.dentalMonthly||0)+(b.visionMonthly||0)+(b.otherMonthly||0);
  const benefits = monthly/4.33 + wages*(b.retirement401k||0)/100;
  return { wages, otPremium, taxes, benefits, total:wages+taxes+benefits, otHrs, totalHrs, taxBreakdown:tb };
}

function rowStatus(role, dayHours, ot) {
  const O = ot||DEFAULT_OT;
  const totalHrs = DAYS.reduce((s,d)=>s+(parseFloat(dayHours[d])||0),0);
  const maxDay = Math.max(...DAYS.map(d=>parseFloat(dayHours[d])||0));
  if (O.dailyMax>0 && maxDay>O.dailyMax) return "daymax";
  // Exempt salaried: never flag OT
  const otApplies = role.payType==="Hourly" ? role.otEligible : !role.exempt;
  if (otApplies && totalHrs>O.weeklyThreshold) return "ot";
  if (otApplies && totalHrs>=O.weeklyThreshold*0.85) return "nearot";
  return "ok";
}

const STATUS = {
  ok:     { rowBg:"transparent",  icon:null,  },
  nearot: { rowBg:"#FFFDF0",      icon:"🔶",  },
  ot:     { rowBg:"#FEF3C7",      icon:"⚠️",  },
  daymax: { rowBg:"#FEE2E2",      icon:"🚨",  },
};

// ── Storage helpers ───────────────────────────────────────────────
async function loadS(key,fallback) { try{const r=await window.storage.get(key);return r?JSON.parse(r.value):fallback;}catch{return fallback;} }
async function loadSWithTs(key,fallback) { try{const r=await window.storage.get(key);return r?{value:JSON.parse(r.value),updated_at:r.updated_at||null}:{value:fallback,updated_at:null};}catch{return{value:fallback,updated_at:null};} }
async function saveS(key,val) { try{await window.storage.set(key,JSON.stringify(val));}catch{} }


// ── Brand primitives ──────────────────────────────────────────────
const CAT_STYLE = {
  BOH:{bg:CN.orangeLight,text:CN.orange}, FOH:{bg:CN.blueLight,text:CN.blue},
  Management:{bg:CN.purpleLight,text:CN.purple}, Other:{bg:CN.creamDark,text:CN.mid},
};
function Tag({cat,small}) {
  const cs=CAT_STYLE[cat]||CAT_STYLE.Other;
  return <span style={{display:"inline-block",padding:small?"1px 7px":"2px 10px",borderRadius:"99px",fontSize:small?"10px":"11px",fontWeight:700,backgroundColor:cs.bg,color:cs.text}}>{cat}</span>;
}

const baseInp = {border:`1.5px solid ${CN.border}`,borderRadius:"8px",padding:"8px 12px",fontSize:"13px",width:"100%",boxSizing:"border-box",outline:"none",backgroundColor:CN.white,fontFamily:"'DM Sans',sans-serif",color:CN.dark};

function Field({label,note,type="text",value,onChange,min,max,step,placeholder,style={},disabled}) {
  const [foc,setFoc]=useState(false);
  return (
    <div style={{marginBottom:"12px"}}>
      {label&&<label style={{fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,display:"block",marginBottom:"4px"}}>{label}</label>}
      <input type={type} value={value} placeholder={placeholder} min={min} max={max} step={step} disabled={disabled}
        onChange={e=>onChange(type==="number"?(e.target.value===""?"":Number(e.target.value)):e.target.value)}
        style={{...baseInp,...style,borderColor:foc?CN.orange:CN.border,opacity:disabled?0.5:1}}
        onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}/>
      {note&&<p style={{fontSize:"11px",color:CN.mid,marginTop:"3px",margin:"3px 0 0"}}>{note}</p>}
    </div>
  );
}

function Pick({label,value,onChange,options}) {
  return (
    <div style={{marginBottom:"12px"}}>
      {label&&<label style={{fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,display:"block",marginBottom:"4px"}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)} style={{...baseInp}}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
    </div>
  );
}

function Btn({onClick,children,variant="primary",style={}}) {
  const base={border:"none",borderRadius:"8px",padding:"8px 18px",fontSize:"12px",fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Barlow Condensed',sans-serif"};
  const v={
    primary:{...base,backgroundColor:CN.orange,color:CN.white},
    secondary:{...base,backgroundColor:CN.creamDark,color:CN.dark},
    ghost:{...base,backgroundColor:"transparent",color:CN.blue,padding:"3px 0"},
    danger:{...base,backgroundColor:"transparent",color:CN.red,padding:"3px 0"},
  };
  return <button onClick={onClick} style={{...v[variant],...style}}>{children}</button>;
}

function Card({children,style={}}) {
  return <div style={{backgroundColor:CN.white,border:`1.5px solid ${CN.border}`,borderRadius:"12px",padding:"20px",marginBottom:"14px",...style}}>{children}</div>;
}
function SHead({title,sub}) {
  return <div style={{marginBottom:"20px"}}>
    <h2 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:"22px",textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,margin:0}}>{title}</h2>
    {sub&&<p style={{fontSize:"13px",color:CN.mid,marginTop:"4px",margin:"4px 0 0"}}>{sub}</p>}
  </div>;
}
function Sub({children}) {
  return <h3 style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:"15px",textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,margin:"0 0 12px"}}>{children}</h3>;
}
function Note({children,type="info"}) {
  const s={info:{bg:CN.creamDark,border:CN.border,text:CN.mid},warning:{bg:CN.amberLight,border:CN.amber,text:"#92400E"},alert:{bg:CN.orangeLight,border:CN.orange,text:CN.orangeHover},success:{bg:CN.greenLight,border:CN.green,text:CN.green}};
  const st=s[type]||s.info;
  return <div style={{backgroundColor:st.bg,border:`1px solid ${st.border}`,borderRadius:"8px",padding:"10px 14px",fontSize:"12px",color:st.text,marginBottom:"12px"}}>{children}</div>;
}

// ── Save Bar ──────────────────────────────────────────────────────
function SaveBar({dirty,onSave,onClear,saving,isMobile}) {
  const [confirmClear,setConfirmClear]=useState(false);
  const handleClear=()=>{ if(confirmClear){onClear();setConfirmClear(false);}else setConfirmClear(true); };
  useEffect(()=>{ if(!dirty) setConfirmClear(false); },[dirty]);
  const bar={
    display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",
    ...(isMobile?{
      position:"fixed",bottom:0,left:0,right:0,zIndex:100,
      backgroundColor:CN.white,borderTop:`2px solid ${dirty?CN.orange:CN.border}`,
      padding:"12px 16px",boxShadow:"0 -4px 20px rgba(0,0,0,0.08)",
    }:{
      borderTop:`1.5px solid ${dirty?CN.orange:CN.border}`,
      marginTop:"20px",paddingTop:"16px",transition:"border-color 0.2s",
    }),
  };
  return (
    <div style={bar}>
      <div style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:dirty?CN.orange:CN.mid,fontWeight:dirty?600:400}}>
        {dirty&&<span style={{width:"7px",height:"7px",borderRadius:"50%",backgroundColor:CN.orange,display:"inline-block",flexShrink:0}}/>}
        <span>{dirty?"Unsaved changes":"All saved"}</span>
      </div>
      <div style={{display:"flex",gap:"8px"}}>
        <button onClick={handleClear}
          style={{padding:"7px 14px",border:`1.5px solid ${confirmClear?CN.red:CN.border}`,borderRadius:"8px",
            backgroundColor:confirmClear?"#FEE2E2":CN.white,color:confirmClear?CN.red:CN.mid,
            fontSize:"12px",fontWeight:700,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",
            textTransform:"uppercase",letterSpacing:"0.06em",transition:"all 0.15s"}}>
          {confirmClear?"Confirm clear":"Clear"}
        </button>
        <button onClick={onSave} disabled={!dirty||saving}
          style={{padding:"7px 18px",border:"none",borderRadius:"8px",
            backgroundColor:dirty&&!saving?CN.orange:CN.creamDark,
            color:dirty&&!saving?CN.white:CN.mid,
            fontSize:"12px",fontWeight:700,cursor:dirty&&!saving?"pointer":"default",
            fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em",
            transition:"all 0.15s",minWidth:"70px"}}>
          {saving?"Saving…":"Save"}
        </button>
      </div>
    </div>
  );
}

// ── Scenario Selector ─────────────────────────────────────────────
function ScenarioSelector({ scenarios, activeId, onSwitch, onCreate, onDelete, label="Scenario" }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const active = scenarios.find(s=>s.id===activeId);

  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
        <span style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.mid}}>{label}:</span>
        <button onClick={()=>setOpen(v=>!v)}
          style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 12px",backgroundColor:CN.white,
            border:`1.5px solid ${CN.orange}`,borderRadius:"8px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
            fontSize:"13px",fontWeight:600,color:CN.dark,minWidth:"160px",justifyContent:"space-between"}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{active?.name||"Select…"}</span>
          <span style={{fontSize:"10px",color:CN.mid}}>▼</span>
        </button>
        {scenarios.length < MAX_SCENARIOS && (
          <button onClick={()=>setCreating(true)} title="New scenario"
            style={{padding:"7px 10px",backgroundColor:CN.orange,border:"none",borderRadius:"8px",
              color:CN.white,cursor:"pointer",fontSize:"14px",fontWeight:700,lineHeight:1}}>+</button>
        )}
      </div>

      {open && (
        <>
          <div style={{position:"fixed",inset:0,zIndex:200}} onClick={()=>setOpen(false)}/>
          <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:"220px",backgroundColor:CN.white,
            borderRadius:"10px",boxShadow:"0 8px 32px rgba(0,0,0,0.15)",border:`1px solid ${CN.border}`,zIndex:201,overflow:"hidden"}}>
            {scenarios.map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"10px 12px",backgroundColor:s.id===activeId?CN.orangeLight:"transparent",
                borderBottom:`1px solid ${CN.creamDark}`,gap:"8px"}}>
                <button onClick={()=>{onSwitch(s.id);setOpen(false);}}
                  style={{flex:1,textAlign:"left",background:"none",border:"none",cursor:"pointer",
                    fontSize:"13px",fontWeight:s.id===activeId?700:400,color:s.id===activeId?CN.orange:CN.dark,
                    fontFamily:"'DM Sans',sans-serif",padding:0}}>
                  {s.id===activeId?"✓ ":""}{s.name}
                </button>
                {scenarios.length>1&&(
                  confirmDelete===s.id
                    ? <div style={{display:"flex",gap:"4px"}}>
                        <button onClick={()=>{onDelete(s.id);setConfirmDelete(null);setOpen(false);}}
                          style={{fontSize:"10px",padding:"2px 6px",backgroundColor:CN.red,color:CN.white,border:"none",borderRadius:"4px",cursor:"pointer"}}>Delete</button>
                        <button onClick={()=>setConfirmDelete(null)}
                          style={{fontSize:"10px",padding:"2px 6px",backgroundColor:CN.creamDark,color:CN.mid,border:"none",borderRadius:"4px",cursor:"pointer"}}>Cancel</button>
                      </div>
                    : <button onClick={()=>setConfirmDelete(s.id)}
                        style={{fontSize:"11px",color:CN.mid,background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:"4px"}}
                        title="Delete scenario">🗑</button>
                )}
              </div>
            ))}
            <div style={{padding:"8px",borderTop:`1px solid ${CN.border}`,fontSize:"11px",color:CN.mid,textAlign:"center"}}>
              {scenarios.length}/{MAX_SCENARIOS} scenarios used
            </div>
          </div>
        </>
      )}

      {creating && (
        <div style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.4)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
          <div style={{backgroundColor:CN.white,borderRadius:"14px",padding:"24px",maxWidth:"340px",width:"100%",boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:"18px",color:CN.dark,marginBottom:"16px",textTransform:"uppercase"}}>New Scenario</div>
            <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&newName.trim()){onCreate(newName.trim());setNewName("");setCreating(false);}}}
              placeholder="e.g. Peak Season, Lean Week…"
              style={{...baseInp,marginBottom:"12px"}}/>
            <div style={{display:"flex",gap:"8px"}}>
              <Btn onClick={()=>{if(newName.trim()){onCreate(newName.trim());setNewName("");setCreating(false);}}} style={{opacity:newName.trim()?1:0.4}}>Create</Btn>
              <Btn variant="secondary" onClick={()=>{setNewName("");setCreating(false);}}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// th / td base styles
const TH = {padding:"9px 8px",backgroundColor:CN.creamDark,border:`1px solid ${CN.border}`,fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"};
const TD = {padding:"0",fontSize:"13px",fontFamily:"'DM Sans',sans-serif",verticalAlign:"middle",border:`1px solid ${CN.creamDark}`};


// ── Role Form ─────────────────────────────────────────────────────
function RoleForm({initial,onSave,onCancel,taxForYear,ot}) {
  const blank={name:"",category:"BOH",payType:"Hourly",rate:"",defaultHours:35,otEligible:true,exempt:false,benefits:{...DEFAULT_BENEFITS},active:true};
  const [f,setF]=useState(initial?{...initial,benefits:{...DEFAULT_BENEFITS,...(initial.benefits||{})}}:blank);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const setB=(k,v)=>setF(p=>({...p,benefits:{...p.benefits,[k]:v}}));

  const activeTax = taxForYear || DEFAULT_TAX;
  const taxOk = activeTax?.finalized !== false;
  const minW = f.payType==="Hourly" && Number(f.rate)>0 && Number(f.rate)<(activeTax?.minWage||DEFAULT_TAX.minWage);

  // Auto-exempt logic: derive from salary amount
  const exemptThreshold = ot?.nonExemptWeeklyMin || DEFAULT_OT.nonExemptWeeklyMin;
  const weeklyEquiv = f.payType==="Salary" ? (Number(f.rate)||0) / 4.33 : null;
  const forcedNonExempt = f.payType==="Salary" && weeklyEquiv !== null && weeklyEquiv < exemptThreshold;
  // Keep f.exempt in sync: if forced, always nonexempt
  const effectiveExempt = forcedNonExempt ? false : f.exempt;

  const valid = f.name.trim() && f.rate!=="" && Number(f.rate)>0 && taxOk;
  const previewDays = DAYS.reduce((a,d,i)=>({...a,[d]:i<5?(f.defaultHours||0)/5:0}),{});
  const prev = f.name.trim()&&f.rate!==""&&Number(f.rate)>0 ? calcRowCost({...f,exempt:effectiveExempt,rate:Number(f.rate)},previewDays,activeTax,ot) : null;

  const handlePayType = (v) => {
    set("payType",v);
    if (v==="Salary") { set("otEligible",false); set("exempt",true); }
    else { set("otEligible",true); set("exempt",false); }
  };

  return (
    <Card style={{border:`1.5px solid ${CN.orange}`,marginBottom:"12px"}}>
      <Sub>{initial?"Edit Role":"Add New Role"}</Sub>
      {!taxOk&&<Note type="alert">⚠️ Finalize Tax & Regulations settings before adding roles — tax rates affect cost calculations.</Note>}
      {minW&&<Note type="alert">⚠️ Rate ${f.rate}/hr is below WA minimum wage ${activeTax?.minWage||DEFAULT_TAX.minWage}/hr ({activeTax?.effectiveDate||"Jan 1, 2025"}).</Note>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <div style={{gridColumn:"1/-1"}}><Field label="Job Title" value={f.name} onChange={v=>set("name",v)} placeholder="e.g. Line Cook"/></div>
        <Pick label="Category" value={f.category} onChange={v=>set("category",v)} options={CATEGORIES}/>
        <Pick label="Pay Type" value={f.payType} onChange={handlePayType} options={PAY_TYPES}/>
        <Field label={f.payType==="Hourly"?"Hourly Rate ($)":"Monthly Salary ($)"} type="number" value={f.rate} onChange={v=>set("rate",v)} min={0} step={0.5}/>
        {f.payType==="Hourly"&&<Field label="Default Hrs/Week" type="number" value={f.defaultHours} onChange={v=>set("defaultHours",v)} min={0} step={1}/>}
      </div>

      {f.payType==="Hourly"&&(
        <div style={{marginBottom:"12px"}}>
          <label style={{fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,display:"block",marginBottom:"6px"}}>Overtime Eligible</label>
          <label style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"}}>
            <input type="checkbox" checked={f.otEligible} onChange={e=>set("otEligible",e.target.checked)} style={{width:"15px",height:"15px",accentColor:CN.orange}}/>
            <span style={{fontSize:"13px",color:CN.dark}}>Yes — 1.5× after {ot?.weeklyThreshold||40} hrs/week (FLSA / WA)</span>
          </label>
        </div>
      )}

      {f.payType==="Salary"&&(
        <Card style={{backgroundColor:CN.creamDark,border:`1px solid ${CN.border}`,padding:"14px 16px",marginBottom:"12px"}}>
          <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.mid,marginBottom:"10px"}}>WA Salary Exemption Status</div>

          {forcedNonExempt&&(
            <Note type="warning">
              ⚠️ Monthly salary of {fmt$(Number(f.rate)||0)} = <strong>{fmt$(weeklyEquiv||0)}/wk</strong> — below the WA exempt threshold of <strong>{fmt$(exemptThreshold)}/wk</strong>. This role <strong>must</strong> be classified as Nonexempt. Increase salary above {fmt$(exemptThreshold*4.33)}/mo to enable exempt classification.
            </Note>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            <label style={{display:"flex",alignItems:"flex-start",gap:"10px",cursor:forcedNonExempt?"not-allowed":"pointer",padding:"10px",backgroundColor:effectiveExempt?CN.purpleLight:"transparent",borderRadius:"8px",border:`1px solid ${effectiveExempt?CN.purple:CN.border}`,opacity:forcedNonExempt?0.4:1}}>
              <input type="radio" checked={effectiveExempt} disabled={forcedNonExempt} onChange={()=>set("exempt",true)} style={{marginTop:"2px",accentColor:CN.purple}}/>
              <div>
                <div style={{fontWeight:600,fontSize:"13px",color:CN.dark}}>Exempt (Executive / Administrative / Professional)</div>
                <div style={{fontSize:"11px",color:CN.mid,marginTop:"2px"}}>Salary ≥ {fmt$(exemptThreshold)}/wk. No OT owed regardless of hours. Weekly cost is fixed.</div>
              </div>
            </label>
            <label style={{display:"flex",alignItems:"flex-start",gap:"10px",cursor:"pointer",padding:"10px",backgroundColor:!effectiveExempt?CN.amberLight:"transparent",borderRadius:"8px",border:`1px solid ${!effectiveExempt?CN.amber:CN.border}`}}>
              <input type="radio" checked={!effectiveExempt} onChange={()=>set("exempt",false)} style={{marginTop:"2px",accentColor:CN.amber}}/>
              <div>
                <div style={{fontWeight:600,fontSize:"13px",color:CN.dark}}>Nonexempt Salaried</div>
                <div style={{fontSize:"11px",color:CN.mid,marginTop:"2px"}}>OT applies after {ot?.weeklyThreshold||40} hrs/week. Cost = salary + half-time premium for OT hours. lni.wa.gov</div>
              </div>
            </label>
          </div>
        </Card>
      )}

      <div style={{borderTop:`1px solid ${CN.border}`,paddingTop:"16px",marginTop:"4px"}}>
        <Sub>Benefits (Employer Cost)</Sub>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0 16px"}}>
          <Field label="Health ($/mo)" type="number" value={f.benefits.healthMonthly} onChange={v=>setB("healthMonthly",v)} min={0} step={10} note="Employer share only."/>
          <Field label="Dental ($/mo)" type="number" value={f.benefits.dentalMonthly} onChange={v=>setB("dentalMonthly",v)} min={0} step={5}/>
          <Field label="Vision ($/mo)" type="number" value={f.benefits.visionMonthly} onChange={v=>setB("visionMonthly",v)} min={0} step={5}/>
          <Field label="401k Match (%)" type="number" value={f.benefits.retirement401k} onChange={v=>setB("retirement401k",v)} min={0} step={0.5} note="% of gross wages."/>
          <Field label="Other ($/mo)" type="number" value={f.benefits.otherMonthly} onChange={v=>setB("otherMonthly",v)} min={0} step={10}/>
        </div>
      </div>
      {prev&&(
        <div style={{backgroundColor:CN.creamDark,borderRadius:"10px",padding:"14px 16px",marginBottom:"16px"}}>
          <div style={{fontSize:"11px",color:CN.mid,marginBottom:"8px",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Weekly cost preview — 1 employee, 5-day week</div>
          <div style={{display:"flex",gap:"20px",alignItems:"center",flexWrap:"wrap"}}>
            {[["Wages",prev.wages],["Taxes",prev.taxes],["Benefits",prev.benefits]].map(([l,v])=>(
              <div key={l}><div style={{fontSize:"10px",color:CN.mid}}>{l}</div><div style={{fontSize:"16px",fontWeight:600,color:CN.dark}}>{fmt$(v)}</div></div>
            ))}
            <div style={{borderLeft:`2px solid ${CN.orange}`,paddingLeft:"16px"}}>
              <div style={{fontSize:"10px",color:CN.mid}}>Total all-in</div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"24px",fontWeight:800,color:CN.orange}}>{fmt$(prev.total)}</div>
            </div>
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:"8px"}}>
        <Btn onClick={()=>valid&&onSave({...f,id:initial?.id||uid(),rate:Number(f.rate),exempt:effectiveExempt})} style={{opacity:valid?1:0.4}}>
          {initial?"Save Changes":"Add Role"}
        </Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────
function RolesTab({roleScenarios,setRoleScenarios,taxYears,ot,dirty,onSave,onClear,saving,isMobile,isAdmin}) {
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState(null);
  const [adminSaveConfirm,setAdminSaveConfirm]=useState(false); // admin editing default

  const activeScenario = roleScenarios.scenarios.find(s=>s.id===roleScenarios.activeId);
  const roles = activeScenario?.roles || [];
  const isDefault = !!activeScenario?.isDefault;
  const readOnly = isDefault && !isAdmin;
  const hasCustomScenarios = roleScenarios.scenarios.some(s=>!s.isDefault);

  // Use current calendar year's tax for role form
  const currentYear = new Date().getFullYear();
  const taxForYear = taxYears?.[currentYear] || null;

  const updateRoles = (fn) => {
    setRoleScenarios(prev=>({
      ...prev,
      scenarios: prev.scenarios.map(s=>s.id===prev.activeId ? {...s,roles:fn(s.roles)} : s)
    }));
  };

  const saveRole=(role)=>{updateRoles(rs=>rs.find(r=>r.id===role.id)?rs.map(r=>r.id===role.id?role:r):[...rs,role]);setAdding(false);setEditing(null);};
  const toggle=(id)=>updateRoles(rs=>rs.map(r=>r.id===id?{...r,active:!r.active}:r));
  const remove=(id)=>{if(window.confirm("Remove this role?"))updateRoles(rs=>rs.filter(r=>r.id!==id));};
  const grouped=CATEGORIES.reduce((a,c)=>{a[c]=roles.filter(r=>r.category===c);return a;},{});

  const handleCreateScenario=(name)=>{
    const newS=makeRoleScenario(name,[]);
    setRoleScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));
  };
  const handleDeleteScenario=(id)=>{
    setRoleScenarios(prev=>{
      const remaining=prev.scenarios.filter(s=>s.id!==id);
      return {scenarios:remaining,activeId:prev.activeId===id?remaining[0]?.id||null:prev.activeId};
    });
  };
  const copyDefaultToNew=()=>{
    const name=`Custom — ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
    const newS=makeRoleScenario(name,roles,false);
    setRoleScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));
  };

  const handleSave=()=>{
    if(isDefault&&isAdmin){setAdminSaveConfirm(true);}
    else{onSave();}
  };

  return (
    <div>
      {/* Admin save confirmation modal */}
      {adminSaveConfirm&&(
        <div style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{backgroundColor:CN.white,borderRadius:14,padding:24,maxWidth:380,width:"100%",boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
            <div style={{fontSize:28,marginBottom:8}}>⚠️</div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:18,color:CN.dark,marginBottom:8,textTransform:"uppercase"}}>Save Default Roles</div>
            <p style={{fontSize:13,color:CN.mid,marginBottom:20,lineHeight:1.6}}>
              You are saving changes to the <strong>Default</strong> role scenario. This affects all users who haven't created a custom scenario. Continue?
            </p>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={()=>{onSave();setAdminSaveConfirm(false);}}>Confirm Save</Btn>
              <Btn variant="secondary" onClick={()=>setAdminSaveConfirm(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px",flexWrap:"wrap",gap:"10px"}}>
        <div>
          <SHead title="Job Roles" sub="Define roles and rates per scenario. Each active role appears in the weekly schedule."/>
          {isDefault&&<span style={{display:"inline-block",fontSize:10,fontWeight:700,backgroundColor:CN.amberLight,color:"#92400E",padding:"2px 10px",borderRadius:99,textTransform:"uppercase",letterSpacing:"0.06em"}}>{isAdmin?"Default (admin edit enabled)":"Default — read only"}</span>}
        </div>
        <ScenarioSelector
          scenarios={roleScenarios.scenarios}
          activeId={roleScenarios.activeId}
          onSwitch={id=>setRoleScenarios(prev=>({...prev,activeId:id}))}
          onCreate={handleCreateScenario}
          onDelete={handleDeleteScenario}
          label="Role Scenario"
        />
      </div>

      {/* No custom scenario warning */}
      {!hasCustomScenarios&&(
        <Note type="warning">
          ⚠️ No custom role scenario exists yet. Copy the Default to create your own editable scenario, or ask an admin to make changes to the Default.
        </Note>
      )}

      {/* Default read-only banner for non-admins */}
      {isDefault&&!isAdmin&&(
        <Note type="info">
          This is the <strong>Default</strong> scenario and cannot be edited directly. Copy it to create your own custom scenario.
        </Note>
      )}

      {!activeScenario&&(
        <Note type="alert">No scenario selected. Create a scenario to start adding roles.</Note>
      )}

      {/* Actions row */}
      {activeScenario&&(
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {/* Add role — hidden for non-admin default */}
          {(!isDefault||isAdmin)&&!adding&&!editing&&(
            <Btn onClick={()=>setAdding(true)}>+ Add Role</Btn>
          )}
          {/* Copy default button */}
          {isDefault&&(
            <Btn variant="secondary" onClick={copyDefaultToNew}>Copy to New Scenario</Btn>
          )}
        </div>
      )}

      {adding&&<RoleForm onSave={saveRole} onCancel={()=>setAdding(false)} taxForYear={taxForYear} ot={ot}/>}

      {CATEGORIES.map(cat=>grouped[cat]?.length===0?null:(
        <div key={cat} style={{marginBottom:"24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
            <Tag cat={cat}/><span style={{fontSize:"12px",color:CN.mid}}>{grouped[cat].length} role{grouped[cat].length!==1?"s":""}</span>
          </div>
          {grouped[cat].map(role=>(
            editing===role.id
              ?<RoleForm key={role.id} initial={role} onSave={saveRole} onCancel={()=>setEditing(null)} taxForYear={taxForYear} ot={ot}/>
              :(
                <Card key={role.id} style={{padding:"14px 18px",opacity:role.active?1:0.5,marginBottom:"8px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:"140px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"3px",flexWrap:"wrap"}}>
                        <span style={{fontWeight:600,fontSize:"14px",color:CN.dark}}>{role.name}</span>
                        {role.payType==="Salary"&&(
                          <span style={{fontSize:"10px",fontWeight:700,backgroundColor:role.exempt?CN.purpleLight:CN.amberLight,color:role.exempt?CN.purple:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>
                            {role.exempt?"Exempt":"Nonexempt"}
                          </span>
                        )}
                        {role.payType==="Hourly"&&role.otEligible&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:CN.amberLight,color:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>OT eligible</span>}
                        {!role.active&&<span style={{fontSize:"11px",color:CN.mid}}>(inactive)</span>}
                      </div>
                      <div style={{fontSize:"12px",color:CN.mid}}>
                        {role.payType==="Hourly"?`${fmt$(role.rate)}/hr · ${role.defaultHours}h/wk default`:`${fmt$(role.rate)}/mo salary`}
                      </div>
                    </div>
                    <div style={{textAlign:"right",marginRight:"8px"}}>
                      <div style={{fontSize:"10px",color:CN.mid}}>Weekly all-in (1 emp.)</div>
                      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"18px",fontWeight:800,color:CN.orange}}>
                        {fmt$(calcRowCost(role,DAYS.reduce((a,d,i)=>({...a,[d]:i<5?role.defaultHours/5:0}),{}),taxForYear||DEFAULT_TAX,ot).total)}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                      <Btn variant="ghost" onClick={readOnly?null:()=>setEditing(role.id)} style={{opacity:readOnly?0.3:1,cursor:readOnly?"not-allowed":"pointer"}}>Edit</Btn>
                      <Btn variant="ghost" onClick={readOnly?null:()=>toggle(role.id)} style={{color:CN.mid,opacity:readOnly?0.3:1,cursor:readOnly?"not-allowed":"pointer"}}>{role.active?"Deactivate":"Activate"}</Btn>
                      <Btn variant="danger" onClick={readOnly?null:()=>remove(role.id)} style={{opacity:readOnly?0.3:1,cursor:readOnly?"not-allowed":"pointer"}}>Remove</Btn>
                    </div>
                  </div>
                </Card>
              )
          ))}
        </div>
      ))}

      {roles.length===0&&!adding&&activeScenario&&(
        <div style={{textAlign:"center",padding:"56px",color:CN.mid}}>
          <div style={{fontSize:"48px",marginBottom:"12px"}}>👥</div>
          <p style={{fontSize:"13px"}}>No roles in this scenario. Add your first role to get started.</p>
        </div>
      )}
      <SaveBar dirty={dirty} onSave={handleSave} onClear={onClear} saving={saving} isMobile={isMobile}/>
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}


// ── Plan Tab ──────────────────────────────────────────────────────
function PlanTab({roleScenarios,planScenarios,setPlanScenarios,taxYears,ot,dirty,onSave,onClear,saving,isMobile,isAdmin}) {
  const [selectedWeek,setSelectedWeek]=useState(isoMonday(toMonday(new Date())));
  const [activeDayIdx,setActiveDayIdx]=useState(()=>{ const d=new Date().getDay(); return d===0?6:d-1; });
  const [adminSaveConfirm,setAdminSaveConfirm]=useState(false);

  const activePlanScenario = planScenarios.scenarios.find(s=>s.id===planScenarios.activeId);
  const linkedRoleScenarioId = activePlanScenario?.roleScenarioId;
  const linkedRoleScenario = roleScenarios.scenarios.find(s=>s.id===linkedRoleScenarioId);
  const availableRoles = (linkedRoleScenario?.roles||[]).filter(r=>r.active);

  const isDefault = !!activePlanScenario?.isDefault;
  const readOnly = isDefault && !isAdmin;
  const hasCustomScenarios = planScenarios.scenarios.some(s=>!s.isDefault);

  // Derive tax from selected week's year
  const weekYear = parseInt(selectedWeek.slice(0,4));
  const tax = taxYears?.[weekYear] || null;
  const taxFinalized = !!tax?.finalized;

  const weekPlans = activePlanScenario?.plans.filter(p=>p.weekOf===selectedWeek) || [];

  const updatePlans = (fn) => {
    setPlanScenarios(prev=>({
      ...prev,
      scenarios: prev.scenarios.map(s=>s.id===prev.activeId ? {...s,plans:fn(s.plans)} : s)
    }));
  };

  const updateDay=(planId,day,val)=>{
    const num=val===""?"":(Math.round(parseFloat(val)*2)/2);
    updatePlans(ps=>ps.map(p=>p.id===planId?{...p,days:{...p.days,[day]:num}}:p));
  };
  const addRow=(roleId)=>updatePlans(ps=>[...ps,{id:uid(),weekOf:selectedWeek,roleId,days:emptyDays()}]);
  const removeRow=(planId)=>updatePlans(ps=>ps.filter(p=>p.id!==planId));
  const shift=(n)=>{const d=new Date(selectedWeek+"T00:00:00");d.setDate(d.getDate()+n*7);setSelectedWeek(isoMonday(d));};

  const copyPrev=()=>{
    const prev=new Date(selectedWeek+"T00:00:00");prev.setDate(prev.getDate()-7);
    const prevStr=isoMonday(prev);
    const prevPlans=(activePlanScenario?.plans||[]).filter(p=>p.weekOf===prevStr);
    if(!prevPlans.length){alert("No plan found for previous week.");return;}
    updatePlans(ps=>[...ps.filter(p=>p.weekOf!==selectedWeek),...prevPlans.map(p=>({...p,id:uid(),weekOf:selectedWeek}))]);
  };

  const O=ot||DEFAULT_OT;

  // Aggregate totals (only for roles in the linked role scenario — hidden rows excluded from cost)
  const visiblePlans = weekPlans.filter(p=>availableRoles.find(r=>r.id===p.roleId));
  const totals=visiblePlans.reduce((acc,plan)=>{
    const role=availableRoles.find(r=>r.id===plan.roleId);
    if(!role)return acc;
    const c=calcRowCost(role,plan.days,tax,ot);
    return{wages:acc.wages+c.wages,taxes:acc.taxes+c.taxes,benefits:acc.benefits+c.benefits,total:acc.total+c.total,otHrs:acc.otHrs+c.otHrs,totalHrs:acc.totalHrs+c.totalHrs};
  },{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});
  const dayTotals=DAYS.reduce((acc,d)=>({...acc,[d]:visiblePlans.reduce((s,p)=>s+(parseFloat(p.days[d])||0),0)}),{});
  const grouped=CATEGORIES.reduce((a,c)=>({...a,[c]:availableRoles.filter(r=>r.category===c)}),{});

  const handleCreatePlanScenario=(name)=>{
    const newS=makePlanScenario(name,linkedRoleScenarioId||null);
    setPlanScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));
  };
  const handleDeletePlanScenario=(id)=>{
    setPlanScenarios(prev=>{
      const remaining=prev.scenarios.filter(s=>s.id!==id);
      return{scenarios:remaining,activeId:prev.activeId===id?remaining[0]?.id||null:prev.activeId};
    });
  };
  const copyDefaultToNew=()=>{
    const name=`Custom — ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;
    const newS=makePlanScenario(name,linkedRoleScenarioId||null,false);
    // Copy current week's plans into the new scenario
    newS.plans=(activePlanScenario?.plans||[]).map(p=>({...p,id:uid()}));
    setPlanScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));
  };
  const handleSave=()=>{
    if(isDefault&&isAdmin){setAdminSaveConfirm(true);}
    else{onSave();}
  };

  const noRoleScenario = !linkedRoleScenario;
  const noRoles = availableRoles.length===0;

  return (
    <div>
      {/* Admin save confirmation modal */}
      {adminSaveConfirm&&(
        <div style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{backgroundColor:CN.white,borderRadius:14,padding:24,maxWidth:380,width:"100%",boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
            <div style={{fontSize:28,marginBottom:8}}>⚠️</div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:18,color:CN.dark,marginBottom:8,textTransform:"uppercase"}}>Save Default Schedule</div>
            <p style={{fontSize:13,color:CN.mid,marginBottom:20,lineHeight:1.6}}>
              You are saving changes to the <strong>Default</strong> schedule scenario. This affects all users who haven't created a custom schedule. Continue?
            </p>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={()=>{onSave();setAdminSaveConfirm(false);}}>Confirm Save</Btn>
              <Btn variant="secondary" onClick={()=>setAdminSaveConfirm(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px",flexWrap:"wrap",gap:"10px"}}>
        <div>
          <SHead title="Weekly Schedule" sub="Enter hours per employee per day."/>
          {isDefault&&<span style={{display:"inline-block",fontSize:10,fontWeight:700,backgroundColor:CN.amberLight,color:"#92400E",padding:"2px 10px",borderRadius:99,textTransform:"uppercase",letterSpacing:"0.06em"}}>{isAdmin?"Default (admin edit enabled)":"Default — read only"}</span>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"8px",alignItems:"flex-end"}}>
          <ScenarioSelector
            scenarios={planScenarios.scenarios}
            activeId={planScenarios.activeId}
            onSwitch={id=>setPlanScenarios(prev=>({...prev,activeId:id}))}
            onCreate={handleCreatePlanScenario}
            onDelete={handleDeletePlanScenario}
            label="Schedule Scenario"
          />
          {activePlanScenario&&(
            <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
              <span style={{fontSize:"11px",color:CN.mid}}>Using roles from:</span>
              <select value={linkedRoleScenarioId||""} onChange={e=>{
                const rid=e.target.value;
                setPlanScenarios(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===prev.activeId?{...s,roleScenarioId:rid}:s)}));
              }} style={{...baseInp,width:"auto",fontSize:"12px",padding:"4px 8px"}}>
                <option value="">— select role scenario —</option>
                {roleScenarios.scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* No custom schedule warning */}
      {!hasCustomScenarios&&(
        <Note type="warning">
          ⚠️ No custom schedule scenario exists yet. Copy the Default to create your own editable scenario.
        </Note>
      )}
      {/* Default read-only banner */}
      {isDefault&&!isAdmin&&(
        <Note type="info">
          This is the <strong>Default</strong> schedule and cannot be edited. Copy it to start your own.
          <span style={{marginLeft:8}}><Btn variant="secondary" onClick={copyDefaultToNew} style={{fontSize:11,padding:"3px 10px"}}>Copy to New</Btn></span>
        </Note>
      )}
      {/* Validation gates */}
      {!activePlanScenario&&<Note type="alert">Create a schedule scenario to start planning.</Note>}
      {activePlanScenario&&noRoleScenario&&<Note type="alert">⚠️ Select a Job Role Scenario above to populate plannable roles.</Note>}
      {activePlanScenario&&linkedRoleScenario&&noRoles&&<Note type="warning">The selected role scenario has no active roles. Add roles in the Job Roles tab first.</Note>}
      {/* Tax year gate — must be finalized for the week's year before costs shown */}
      {activePlanScenario&&linkedRoleScenario&&!noRoles&&!taxFinalized&&(
        <Note type="alert">
          ⚠️ Tax &amp; Regulation settings for <strong>{weekYear}</strong> have not been finalized. Go to the <strong>Taxes &amp; Regulations</strong> tab, select year {weekYear}, complete all fields, and click Finalize to unlock cost calculations.
        </Note>
      )}

      {activePlanScenario&&linkedRoleScenario&&!noRoles&&taxFinalized&&(
        <>
          {/* Week nav */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <Btn variant="secondary" onClick={()=>shift(-1)} style={{padding:"6px 14px"}}>←</Btn>
              <span style={{fontSize:"13px",fontWeight:600,color:CN.dark,minWidth:"200px",textAlign:"center"}}>{fmtWeek(selectedWeek)}</span>
              <Btn variant="secondary" onClick={()=>shift(1)} style={{padding:"6px 14px"}}>→</Btn>
              <Btn variant="secondary" onClick={copyPrev} style={{marginLeft:"6px",fontSize:"11px"}}>Copy prev week</Btn>
            </div>
          </div>

          {/* Totals banner */}
          <div style={{background:`linear-gradient(135deg,${CN.orange} 0%,#FF6B3A 100%)`,borderRadius:"14px",padding:"16px 24px",marginBottom:"14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"12px"}}>
              <div>
                <div style={{fontSize:"11px",color:"rgba(255,255,255,0.75)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Total Planned Labor Cost</div>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"34px",fontWeight:800,color:CN.white,lineHeight:1.1}}>{fmt$(totals.total)}</div>
              </div>
              <div style={{display:"flex",gap:"20px",flexWrap:"wrap"}}>
                {[["Total Hrs",totals.totalHrs.toFixed(1)+"h"],["OT Hrs",totals.otHrs>0?totals.otHrs.toFixed(1)+"h ⚡":"0h"],["Wages",fmt$(totals.wages)],["Taxes",fmt$(totals.taxes)],["Benefits",fmt$(totals.benefits)]].map(([l,v])=>(
                  <div key={l} style={{textAlign:"right"}}>
                    <div style={{fontSize:"10px",color:"rgba(255,255,255,0.7)",textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div>
                    <div style={{fontSize:"16px",fontWeight:600,color:CN.white}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div style={{display:"flex",gap:"14px",marginBottom:"12px",flexWrap:"wrap"}}>
            {[["#FFFDF0","🔶",`Approaching OT (≥${Math.round(O.weeklyThreshold*0.85)}h)`],["#FEF3C7","⚠️",`Overtime (>${O.weeklyThreshold}h/week)`],["#FEE2E2","🚨",`Daily max exceeded (>${O.dailyMax}h/day)`]].map(([bg,icon,label])=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"11px",color:CN.mid}}>
                <div style={{width:"13px",height:"13px",borderRadius:"3px",backgroundColor:bg,border:`1px solid ${CN.border}`,flexShrink:0}}/>
                {icon} {label}
              </div>
            ))}
          </div>

          {/* Mobile: single-day card view */}
          {isMobile ? (
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px",backgroundColor:CN.white,borderRadius:"12px",padding:"10px 14px",border:`1.5px solid ${CN.border}`}}>
                <button onClick={()=>setActiveDayIdx(i=>(i+6)%7)} style={{border:"none",background:CN.creamDark,borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:"16px",fontWeight:700,color:CN.dark}}>←</button>
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:"20px",color:CN.dark,textTransform:"uppercase"}}>{DAY_LABELS[activeDayIdx]}</div>
                  <div style={{fontSize:"11px",color:CN.mid}}>{dayTotals[DAYS[activeDayIdx]]>0?dayTotals[DAYS[activeDayIdx]].toFixed(1)+"h total":"No hours"}</div>
                </div>
                <button onClick={()=>setActiveDayIdx(i=>(i+1)%7)} style={{border:"none",background:CN.creamDark,borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:"16px",fontWeight:700,color:CN.dark}}>→</button>
              </div>
              <div style={{display:"flex",gap:"6px",marginBottom:"14px",justifyContent:"center"}}>
                {DAY_LABELS.map((dl,i)=>(
                  <button key={dl} onClick={()=>setActiveDayIdx(i)}
                    style={{border:`1px solid ${i===activeDayIdx?CN.orange:CN.border}`,borderRadius:"99px",padding:"4px 10px",fontSize:"11px",fontWeight:700,cursor:"pointer",backgroundColor:i===activeDayIdx?CN.orange:dayTotals[DAYS[i]]>0?CN.creamDark:CN.white,color:i===activeDayIdx?CN.white:CN.dark}}>{dl}</button>
                ))}
              </div>
              {CATEGORIES.map(cat=>{
                const catRoles=grouped[cat];
                if(!catRoles.length)return null;
                return (
                  <div key={cat} style={{marginBottom:"16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}><Tag cat={cat} small/></div>
                    {catRoles.map(role=>{
                      const roleRows=weekPlans.filter(p=>p.roleId===role.id);
                      const activeDay=DAYS[activeDayIdx];
                      return (
                        <div key={role.id}>
                          {roleRows.map((plan,empIdx)=>{
                            const cost=calcRowCost(role,plan.days,tax,ot);
                            const st=rowStatus(role,plan.days,ot);
                            const h=plan.days[activeDay];
                            const hNum=parseFloat(h)||0;
                            const overDay=O.dailyMax>0&&hNum>O.dailyMax;
                            return (
                              <div key={plan.id} style={{backgroundColor:STATUS[st].rowBg,border:`1.5px solid ${overDay?CN.red:CN.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"8px"}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                                  <div>
                                    <div style={{fontWeight:600,fontSize:"14px",color:CN.dark,display:"flex",alignItems:"center",gap:"4px"}}>
                                      {STATUS[st].icon&&<span>{STATUS[st].icon}</span>}{role.name} <span style={{fontSize:"11px",color:CN.mid,fontWeight:400}}>#{empIdx+1}</span>
                                    </div>
                                    <div style={{fontSize:"11px",color:CN.mid}}>{role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo ${role.exempt?"(exempt)":"(nonexempt)"}`}</div>
                                  </div>
                                  <div style={{textAlign:"right"}}>
                                    <div style={{fontSize:"10px",color:CN.mid}}>Week cost</div>
                                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange}}>{cost.total>0?fmt$(cost.total):"—"}</div>
                                  </div>
                                </div>
                                <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                                  <label style={{fontSize:"11px",fontWeight:600,color:CN.mid,textTransform:"uppercase",whiteSpace:"nowrap"}}>Hours {DAY_LABELS[activeDayIdx]}</label>
                                  <input type="number" min={0} max={24} step={0.5} value={h} placeholder="0"
                                    onChange={e=>updateDay(plan.id,activeDay,e.target.value)}
                                    style={{flex:1,textAlign:"center",border:`1.5px solid ${overDay?CN.red:CN.border}`,borderRadius:"8px",padding:"10px",fontSize:"18px",fontWeight:700,fontFamily:"'DM Sans',sans-serif",backgroundColor:overDay?"#FEE2E2":CN.white,color:overDay?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}
                                  />
                                  <button onClick={()=>removeRow(plan.id)} style={{border:`1px solid ${CN.border}`,background:CN.white,cursor:"pointer",color:CN.mid,fontSize:"13px",padding:"8px 10px",borderRadius:"8px"}}>✕</button>
                                </div>
                                <div style={{display:"flex",gap:"12px",marginTop:"8px",flexWrap:"wrap"}}>
                                  <span style={{fontSize:"11px",color:CN.mid}}>Week: <strong style={{color:CN.dark}}>{cost.totalHrs>0?cost.totalHrs.toFixed(1)+"h":"—"}</strong></span>
                                  {cost.otHrs>0&&<span style={{fontSize:"11px",color:CN.amberDark,fontWeight:700}}>⚡ {cost.otHrs.toFixed(1)}h OT (+{fmt$(cost.otPremium)})</span>}
                                </div>
                              </div>
                            );
                          })}
                          <button onClick={()=>addRow(role.id)} style={{border:`1px dashed ${CN.orange}`,background:"none",cursor:"pointer",color:CN.orange,fontSize:"12px",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",padding:"8px 14px",borderRadius:"8px",width:"100%",marginBottom:"8px"}}>
                            + Add {role.name}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Desktop: full table */
            <div style={{overflowX:"auto",borderRadius:"12px",border:`1.5px solid ${CN.border}`}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px",minWidth:"860px"}}>
                <thead>
                  <tr>
                    <th style={{...TH,textAlign:"left",width:"170px"}}>Employee / Role</th>
                    {DAY_LABELS.map(d=><th key={d} style={{...TH,textAlign:"center",width:"75px"}}>{d}</th>)}
                    <th style={{...TH,textAlign:"center",width:"72px"}}>Total Hrs</th>
                    <th style={{...TH,textAlign:"center",width:"68px"}}>OT Hrs</th>
                    <th style={{...TH,textAlign:"right",width:"105px",paddingRight:"14px"}}>Weekly Cost</th>
                  </tr>
                </thead>
                {CATEGORIES.map(cat=>{
                  const catRoles=grouped[cat];
                  if(!catRoles.length)return null;
                  const catPlans=weekPlans.filter(p=>catRoles.find(r=>r.id===p.roleId));
                  const catTotal=catPlans.reduce((s,plan)=>{
                    const role=availableRoles.find(r=>r.id===plan.roleId);
                    return role?s+calcRowCost(role,plan.days,tax,ot).total:s;
                  },0);
                  return (
                    <tbody key={cat}>
                      <tr style={{backgroundColor:CN.cream}}>
                        <td colSpan={11} style={{padding:"8px 12px",borderTop:`1px solid ${CN.border}`,borderBottom:`1px solid ${CN.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                            <Tag cat={cat} small/>
                            <span style={{fontSize:"11px",color:CN.mid}}>
                              {catPlans.length} employee{catPlans.length!==1?"s":""} scheduled
                              {catTotal>0&&<strong style={{color:CN.dark,marginLeft:"6px"}}>· {fmt$(catTotal)}</strong>}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {catRoles.map(role=>{
                        const roleRows=weekPlans.filter(p=>p.roleId===role.id);
                        return [
                          ...roleRows.map((plan,empIdx)=>{
                            const cost=calcRowCost(role,plan.days,tax,ot);
                            const st=rowStatus(role,plan.days,ot);
                            return (
                              <tr key={plan.id} style={{backgroundColor:STATUS[st].rowBg}}>
                                <td style={{...TD,padding:"8px 10px",borderLeft:"none"}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                    <div>
                                      <div style={{fontWeight:600,color:CN.dark,fontSize:"12px",display:"flex",alignItems:"center",gap:"4px"}}>
                                        {STATUS[st].icon&&<span>{STATUS[st].icon}</span>}{role.name}
                                      </div>
                                      <div style={{fontSize:"10px",color:CN.mid}}>
                                        #{empIdx+1} · {role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo`}
                                        {role.payType==="Salary"&&<span style={{marginLeft:"4px",color:role.exempt?CN.purple:CN.amberDark}}>({role.exempt?"exempt":"nonexempt"})</span>}
                                      </div>
                                      {cost.otHrs>0&&<div style={{fontSize:"10px",color:CN.amberDark,fontWeight:700}}>+{cost.otHrs.toFixed(1)}h OT · +{fmt$(cost.otPremium)}</div>}
                                    </div>
                                    <button onClick={()=>removeRow(plan.id)} style={{border:"none",background:"none",cursor:"pointer",color:CN.border,fontSize:"13px",padding:"0",lineHeight:1}}>✕</button>
                                  </div>
                                </td>
                                {DAYS.map(d=>{
                                  const h=plan.days[d]; const hNum=parseFloat(h)||0;
                                  const overDay=O.dailyMax>0&&hNum>O.dailyMax;
                                  return (
                                    <td key={d} style={{...TD,padding:"5px 4px"}}>
                                      <input type="number" min={0} max={24} step={0.5} value={h} placeholder="–"
                                        onChange={e=>updateDay(plan.id,d,e.target.value)}
                                        style={{width:"100%",textAlign:"center",border:`1.5px solid ${overDay?CN.red:hNum>0?CN.border:CN.creamDark}`,borderRadius:"6px",padding:"6px 2px",fontSize:"13px",fontFamily:"'DM Sans',sans-serif",backgroundColor:overDay?"#FEE2E2":hNum>0?CN.white:CN.creamDark,color:overDay?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}
                                      />
                                    </td>
                                  );
                                })}
                                <td style={{...TD,textAlign:"center",fontWeight:600,padding:"8px",color:cost.otHrs>0?CN.amberDark:CN.dark}}>{cost.totalHrs>0?cost.totalHrs.toFixed(1)+"h":"—"}</td>
                                <td style={{...TD,textAlign:"center",fontWeight:cost.otHrs>0?700:400,padding:"8px",color:cost.otHrs>0?CN.amberDark:CN.mid}}>{cost.otHrs>0?cost.otHrs.toFixed(1)+"h ⚡":"—"}</td>
                                <td style={{...TD,textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"15px",fontWeight:700,color:CN.orange,borderRight:"none",padding:"8px 14px"}}>{cost.total>0?fmt$(cost.total):"—"}</td>
                              </tr>
                            );
                          }),
                          <tr key={"add-"+role.id} style={{backgroundColor:CN.cream}}>
                            <td colSpan={11} style={{padding:"3px 8px",borderTop:`1px solid ${CN.creamDark}`}}>
                              <button onClick={()=>addRow(role.id)} style={{border:"none",background:"none",cursor:"pointer",color:CN.orange,fontSize:"11px",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em",padding:"5px 8px",borderRadius:"6px"}}>
                                + Add {role.name}
                              </button>
                            </td>
                          </tr>
                        ];
                      })}
                    </tbody>
                  );
                })}
                <tfoot>
                  <tr style={{backgroundColor:CN.creamDark}}>
                    <td style={{...TD,padding:"10px 12px",fontWeight:700,fontSize:"11px",textTransform:"uppercase",color:CN.mid,borderTop:`2px solid ${CN.border}`,borderLeft:"none",borderBottom:"none"}}>Daily Totals</td>
                    {DAYS.map(d=>(
                      <td key={d} style={{...TD,textAlign:"center",fontWeight:700,color:CN.dark,borderTop:`2px solid ${CN.border}`,padding:"10px 4px",borderBottom:"none"}}>
                        {dayTotals[d]>0?dayTotals[d].toFixed(1)+"h":"—"}
                      </td>
                    ))}
                    <td style={{...TD,textAlign:"center",fontWeight:800,fontFamily:"'Barlow Condensed',sans-serif",fontSize:"14px",color:CN.orange,borderTop:`2px solid ${CN.border}`,padding:"10px 8px",borderBottom:"none"}}>{totals.totalHrs.toFixed(1)}h</td>
                    <td style={{...TD,textAlign:"center",fontWeight:700,color:totals.otHrs>0?CN.amberDark:CN.mid,borderTop:`2px solid ${CN.border}`,padding:"10px 8px",borderBottom:"none"}}>{totals.otHrs>0?totals.otHrs.toFixed(1)+"h ⚡":"—"}</td>
                    <td style={{...TD,textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange,borderTop:`2px solid ${CN.border}`,borderRight:"none",borderBottom:"none",padding:"10px 14px"}}>{fmt$(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {weekPlans.length===0&&(
            <div style={{textAlign:"center",padding:"40px",color:CN.mid,marginTop:"8px"}}>
              <p style={{fontSize:"13px"}}>No employees scheduled this week. Use the <strong>+ Add [Role]</strong> buttons to add rows.</p>
            </div>
          )}
        </>
      )}

      <SaveBar dirty={dirty} onSave={handleSave} onClear={()=>onClear(selectedWeek)} saving={saving} isMobile={isMobile}/>
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}


// ── Summary Tab ───────────────────────────────────────────────────
function SummaryTab({roleScenarios,planScenarios,taxYears,ot,onRefresh}) {
  // Derive tax for each plan week's year; fall back to most recently finalized year or DEFAULT_TAX
  const getTaxForYear = (year) => {
    if (taxYears?.[year]?.finalized) return taxYears[year];
    const finalized = Object.entries(taxYears||{}).filter(([,v])=>v?.finalized).sort(([a],[b])=>b-a);
    return finalized.length ? finalized[0][1] : DEFAULT_TAX;
  };
  // For summary-level totals use current year
  const currentYear = new Date().getFullYear();
  const tax = getTaxForYear(currentYear);
  const isMobile=useIsMobile();
  const [compareIds,setCompareIds]=useState([]);
  const [activeView,setActiveView]=useState("single"); // "single" | "compare"

  // Build per-scenario summary data
  const buildScenarioData=(planScenario)=>{
    const linkedRoles=(roleScenarios.scenarios.find(s=>s.id===planScenario.roleScenarioId)?.roles||[]).filter(r=>r.active);
    const plans=planScenario.plans;
    const weeks=[...new Set(plans.map(p=>p.weekOf))].sort();
    const weekData=weeks.map(weekOf=>{
      const weekPlans=plans.filter(p=>p.weekOf===weekOf&&linkedRoles.find(r=>r.id===p.roleId));
      const totals=weekPlans.reduce((acc,plan)=>{
        const role=linkedRoles.find(r=>r.id===plan.roleId);
        if(!role)return acc;
        const c=calcRowCost(role,plan.days,tax,ot);
        return{wages:acc.wages+c.wages,taxes:acc.taxes+c.taxes,benefits:acc.benefits+c.benefits,total:acc.total+c.total,otHrs:acc.otHrs+c.otHrs,totalHrs:acc.totalHrs+c.totalHrs};
      },{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});
      return{weekOf,totals,empCount:[...new Set(weekPlans.map(p=>p.id))].length};
    });
    const grandTotal=weekData.reduce((acc,w)=>({wages:acc.wages+w.totals.wages,taxes:acc.taxes+w.totals.taxes,benefits:acc.benefits+w.totals.benefits,total:acc.total+w.totals.total,otHrs:acc.otHrs+w.totals.otHrs,totalHrs:acc.totalHrs+w.totals.totalHrs}),{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});
    return{id:planScenario.id,name:planScenario.name,roleScenarioName:roleScenarios.scenarios.find(s=>s.id===planScenario.roleScenarioId)?.name||"—",weeks:weekData,grandTotal,linkedRoles};
  };

  const allScenarioData=planScenarios.scenarios.map(buildScenarioData);
  const activeScenarioId=planScenarios.activeId;
  const activeSData=allScenarioData.find(s=>s.id===activeScenarioId);
  const compareData=allScenarioData.filter(s=>compareIds.includes(s.id));

  const exportCSV=(sData)=>{
    const rows=[["Week","Total Hours","OT Hours","Wages","Taxes","Benefits","Total Cost"]];
    sData.weeks.forEach(w=>{
      rows.push([w.weekOf,w.totals.totalHrs.toFixed(1),w.totals.otHrs.toFixed(1),w.totals.wages.toFixed(2),w.totals.taxes.toFixed(2),w.totals.benefits.toFixed(2),w.totals.total.toFixed(2)]);
    });
    rows.push(["TOTAL",sData.grandTotal.totalHrs.toFixed(1),sData.grandTotal.otHrs.toFixed(1),sData.grandTotal.wages.toFixed(2),sData.grandTotal.taxes.toFixed(2),sData.grandTotal.benefits.toFixed(2),sData.grandTotal.total.toFixed(2)]);
    const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`${sData.name.replace(/\s+/g,"-")}-labor.csv`;a.click();URL.revokeObjectURL(url);
  };

  const printReport=()=>{
    window.print();
  };

  const maxBarVal=activeSData?Math.max(...activeSData.weeks.map(w=>w.totals.total),1):1;
  const compareMaxVal=compareData.length?Math.max(...compareData.flatMap(s=>s.weeks.map(w=>w.totals.total)),1):1;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px",flexWrap:"wrap",gap:"10px"}}>
        <SHead title="Labor Cost Summary" sub="Actuals by week, exportable by scenario."/>
        <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
          <Btn variant="secondary" onClick={onRefresh}>↻ Refresh</Btn>
          <Btn variant={activeView==="single"?"primary":"secondary"} onClick={()=>setActiveView("single")}>Single</Btn>
          <Btn variant={activeView==="compare"?"primary":"secondary"} onClick={()=>setActiveView("compare")}>Compare</Btn>
        </div>
      </div>

      {planScenarios.scenarios.length===0&&<Note type="alert">No schedule scenarios yet. Create one in the Schedule tab.</Note>}

      {/* ── Single Scenario View ── */}
      {activeView==="single"&&activeSData&&(
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
            <div>
              <span style={{fontSize:"13px",fontWeight:600,color:CN.dark}}>{activeSData.name}</span>
              <span style={{fontSize:"12px",color:CN.mid,marginLeft:"8px"}}>· Roles: {activeSData.roleScenarioName}</span>
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <Btn variant="secondary" onClick={()=>exportCSV(activeSData)}>Export CSV</Btn>
              <Btn variant="secondary" onClick={printReport}>🖨 Print</Btn>
            </div>
          </div>

          {/* KPI strip */}
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:"10px",marginBottom:"16px"}}>
            {[
              ["Total Cost",fmt$(activeSData.grandTotal.total),CN.orange],
              ["Total Hours",activeSData.grandTotal.totalHrs.toFixed(1)+"h",CN.dark],
              ["OT Hours",activeSData.grandTotal.otHrs.toFixed(1)+"h",activeSData.grandTotal.otHrs>0?CN.amberDark:CN.mid],
              ["Weeks Planned",activeSData.weeks.length+"",CN.dark],
            ].map(([l,v,c])=>(
              <div key={l} style={{backgroundColor:CN.white,border:`1.5px solid ${CN.border}`,borderRadius:"12px",padding:"14px 16px"}}>
                <div style={{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,marginBottom:"4px"}}>{l}</div>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"24px",fontWeight:800,color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          {activeSData.weeks.length>0&&(
            <Card>
              <Sub>Weekly Cost</Sub>
              <div style={{display:"flex",gap:"6px",alignItems:"flex-end",height:"120px",marginBottom:"8px",overflowX:"auto",paddingBottom:"4px"}}>
                {activeSData.weeks.map(w=>{
                  const pct=(w.totals.total/maxBarVal)*100;
                  return (
                    <div key={w.weekOf} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px",minWidth:"40px",flex:1}}>
                      <div style={{fontSize:"10px",color:CN.mid,fontWeight:600}}>{fmtK(w.totals.total)}</div>
                      <div style={{width:"100%",backgroundColor:CN.orange,borderRadius:"4px 4px 0 0",height:`${Math.max(pct,2)}%`,transition:"height 0.3s"}}/>
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:"6px",overflowX:"auto"}}>
                {activeSData.weeks.map(w=>(
                  <div key={w.weekOf} style={{minWidth:"40px",flex:1,textAlign:"center",fontSize:"9px",color:CN.mid,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {new Date(w.weekOf+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Weekly table */}
          {activeSData.weeks.length>0?(
            <div className="print-table" style={{overflowX:"auto",borderRadius:"12px",border:`1.5px solid ${CN.border}`}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px",minWidth:"600px"}}>
                <thead>
                  <tr>
                    {["Week","Employees","Total Hrs","OT Hrs","Wages","Taxes","Benefits","Total Cost"].map(h=>(
                      <th key={h} style={{...TH,textAlign:h==="Week"||h==="Employees"?"left":"right"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSData.weeks.map((w,i)=>(
                    <tr key={w.weekOf} style={{backgroundColor:i%2===0?CN.white:CN.cream}}>
                      <td style={{...TD,padding:"10px 12px",borderLeft:"none",fontWeight:600,color:CN.dark,whiteSpace:"nowrap"}}>{fmtWeek(w.weekOf)}</td>
                      <td style={{...TD,padding:"10px 8px",color:CN.mid}}>{w.empCount}</td>
                      <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{w.totals.totalHrs.toFixed(1)}h</td>
                      <td style={{...TD,padding:"10px 8px",textAlign:"right",color:w.totals.otHrs>0?CN.amberDark:CN.mid,fontWeight:w.totals.otHrs>0?700:400}}>{w.totals.otHrs>0?w.totals.otHrs.toFixed(1)+"h ⚡":"—"}</td>
                      <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{fmt$(w.totals.wages)}</td>
                      <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{fmt$(w.totals.taxes)}</td>
                      <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{fmt$(w.totals.benefits)}</td>
                      <td style={{...TD,padding:"10px 8px",textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"15px",fontWeight:700,color:CN.orange,borderRight:"none"}}>{fmt$(w.totals.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{backgroundColor:CN.creamDark}}>
                    <td style={{...TD,padding:"12px",fontWeight:700,fontSize:"11px",textTransform:"uppercase",color:CN.mid,borderTop:`2px solid ${CN.border}`,borderLeft:"none",borderBottom:"none"}}>Total</td>
                    <td style={{...TD,borderTop:`2px solid ${CN.border}`,padding:"12px",borderBottom:"none"}}/>
                    <td style={{...TD,padding:"12px",textAlign:"right",fontWeight:700,borderTop:`2px solid ${CN.border}`,borderBottom:"none"}}>{activeSData.grandTotal.totalHrs.toFixed(1)}h</td>
                    <td style={{...TD,padding:"12px",textAlign:"right",fontWeight:700,color:activeSData.grandTotal.otHrs>0?CN.amberDark:CN.mid,borderTop:`2px solid ${CN.border}`,borderBottom:"none"}}>{activeSData.grandTotal.otHrs>0?activeSData.grandTotal.otHrs.toFixed(1)+"h":"—"}</td>
                    <td style={{...TD,padding:"12px",textAlign:"right",fontWeight:700,borderTop:`2px solid ${CN.border}`,borderBottom:"none"}}>{fmt$(activeSData.grandTotal.wages)}</td>
                    <td style={{...TD,padding:"12px",textAlign:"right",fontWeight:700,borderTop:`2px solid ${CN.border}`,borderBottom:"none"}}>{fmt$(activeSData.grandTotal.taxes)}</td>
                    <td style={{...TD,padding:"12px",textAlign:"right",fontWeight:700,borderTop:`2px solid ${CN.border}`,borderBottom:"none"}}>{fmt$(activeSData.grandTotal.benefits)}</td>
                    <td style={{...TD,padding:"12px",textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"18px",fontWeight:800,color:CN.orange,borderTop:`2px solid ${CN.border}`,borderRight:"none",borderBottom:"none"}}>{fmt$(activeSData.grandTotal.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ):(
            <div style={{textAlign:"center",padding:"48px",color:CN.mid}}>
              <div style={{fontSize:"40px",marginBottom:"12px"}}>📋</div>
              <p style={{fontSize:"13px"}}>No weeks planned in this scenario yet.</p>
            </div>
          )}
        </>
      )}

      {/* ── Comparison View ── */}
      {activeView==="compare"&&(
        <>
          <div style={{marginBottom:"16px"}}>
            <div style={{fontSize:"12px",fontWeight:600,color:CN.mid,marginBottom:"8px",textTransform:"uppercase",letterSpacing:"0.06em"}}>Select scenarios to compare (up to 5):</div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {allScenarioData.map(s=>{
                const sel=compareIds.includes(s.id);
                return (
                  <button key={s.id} onClick={()=>setCompareIds(prev=>sel?prev.filter(id=>id!==s.id):prev.length<5?[...prev,s.id]:prev)}
                    style={{padding:"6px 14px",border:`1.5px solid ${sel?CN.orange:CN.border}`,borderRadius:"8px",backgroundColor:sel?CN.orangeLight:CN.white,color:sel?CN.orange:CN.dark,fontWeight:sel?700:400,fontSize:"12px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    {sel?"✓ ":""}{s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {compareData.length===0&&<Note>Select at least one scenario above to see the comparison.</Note>}

          {compareData.length>0&&(
            <>
              <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
                <Btn variant="secondary" onClick={()=>{compareData.forEach(s=>exportCSV(s));}}>Export All CSV</Btn>
                <Btn variant="secondary" onClick={printReport}>🖨 Print Comparison</Btn>
              </div>

              {/* KPI comparison cards */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":`repeat(${Math.min(compareData.length,3)},1fr)`,gap:"10px",marginBottom:"16px"}}>
                {compareData.map((s,i)=>{
                  const colors=[CN.orange,CN.blue,CN.purple,CN.green,"#EC4899"];
                  const c=colors[i%colors.length];
                  return (
                    <div key={s.id} style={{backgroundColor:CN.white,border:`2px solid ${c}`,borderRadius:"14px",padding:"16px"}}>
                      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:"16px",color:c,textTransform:"uppercase",marginBottom:"2px"}}>{s.name}</div>
                      <div style={{fontSize:"11px",color:CN.mid,marginBottom:"12px"}}>Roles: {s.roleScenarioName}</div>
                      {[["Total Cost",fmt$(s.grandTotal.total)],["Total Hours",s.grandTotal.totalHrs.toFixed(1)+"h"],["OT Hours",s.grandTotal.otHrs.toFixed(1)+"h"],["Weeks",s.weeks.length+""]].map(([l,v])=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",borderBottom:`1px solid ${CN.creamDark}`,padding:"6px 0",fontSize:"13px"}}>
                          <span style={{color:CN.mid}}>{l}</span>
                          <span style={{fontWeight:700,color:CN.dark}}>{v}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Grouped bar chart comparison */}
              <Card>
                <Sub>Total Cost by Scenario</Sub>
                <div style={{display:"flex",gap:"20px",alignItems:"flex-end",height:"140px",marginBottom:"8px"}}>
                  {compareData.map((s,i)=>{
                    const colors=[CN.orange,CN.blue,CN.purple,CN.green,"#EC4899"];
                    const c=colors[i%colors.length];
                    const pct=(s.grandTotal.total/Math.max(...compareData.map(x=>x.grandTotal.total),1))*100;
                    return (
                      <div key={s.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"6px",flex:1}}>
                        <div style={{fontSize:"11px",fontWeight:700,color:c}}>{fmtK(s.grandTotal.total)}</div>
                        <div style={{width:"100%",backgroundColor:c,borderRadius:"4px 4px 0 0",height:`${Math.max(pct,2)}%`}}/>
                        <div style={{fontSize:"10px",color:CN.mid,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{s.name}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Side-by-side table */}
              <div style={{overflowX:"auto",borderRadius:"12px",border:`1.5px solid ${CN.border}`}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px",minWidth:"500px"}}>
                  <thead>
                    <tr>
                      <th style={{...TH,textAlign:"left"}}>Metric</th>
                      {compareData.map(s=><th key={s.id} style={{...TH,textAlign:"right"}}>{s.name}</th>)}
                      {compareData.length===2&&<th style={{...TH,textAlign:"right"}}>Δ Difference</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Total Cost",s=>fmt$(s.grandTotal.total),(a,b)=>{const d=b.grandTotal.total-a.grandTotal.total;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Total Hours",s=>s.grandTotal.totalHrs.toFixed(1)+"h",(a,b)=>{const d=b.grandTotal.totalHrs-a.grandTotal.totalHrs;return{txt:(d>=0?"+":"")+d.toFixed(1)+"h",col:CN.mid};}],
                      ["OT Hours",s=>s.grandTotal.otHrs.toFixed(1)+"h",(a,b)=>{const d=b.grandTotal.otHrs-a.grandTotal.otHrs;return{txt:(d>=0?"+":"")+d.toFixed(1)+"h",col:d>0?CN.amberDark:CN.green};}],
                      ["Wages",s=>fmt$(s.grandTotal.wages),(a,b)=>{const d=b.grandTotal.wages-a.grandTotal.wages;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Taxes",s=>fmt$(s.grandTotal.taxes),(a,b)=>{const d=b.grandTotal.taxes-a.grandTotal.taxes;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Benefits",s=>fmt$(s.grandTotal.benefits),(a,b)=>{const d=b.grandTotal.benefits-a.grandTotal.benefits;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Weeks Planned",s=>s.weeks.length+"",(a,b)=>{const d=b.weeks.length-a.weeks.length;return{txt:(d>=0?"+":"")+d,col:CN.mid};}],
                    ].map(([label,val,diff],ri)=>(
                      <tr key={label} style={{backgroundColor:ri%2===0?CN.white:CN.cream}}>
                        <td style={{...TD,padding:"10px 12px",borderLeft:"none",fontWeight:600,color:CN.mid,fontSize:"12px"}}>{label}</td>
                        {compareData.map(s=><td key={s.id} style={{...TD,padding:"10px 12px",textAlign:"right",fontWeight:label==="Total Cost"?700:400,color:CN.dark}}>{val(s)}</td>)}
                        {compareData.length===2&&(()=>{const {txt,col}=diff(compareData[0],compareData[1]);return <td style={{...TD,padding:"10px 12px",textAlign:"right",fontWeight:700,color:col,borderRight:"none"}}>{txt}</td>;})()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-table, .print-table * { visibility: visible; }
          .print-table { position: absolute; left: 0; top: 0; }
        }
      `}</style>
    </div>
  );
}


// ── Taxes & Regulations Tab ───────────────────────────────────────
function TaxTab({taxYears,setTaxYears,selectedYear,setSelectedYear,ot,setOt,dirty,onSave,onClear,saving,isMobile}) {
  const tax = taxYears?.[selectedYear] || defaultTaxForYear(selectedYear);
  const setTax = (fn) => setTaxYears(prev=>({...prev,[selectedYear]:fn(prev[selectedYear]||defaultTaxForYear(selectedYear))}));

  const allFilled = tax.federalSS && tax.federalMedicare && tax.futa && tax.waSUI && tax.waLnI && tax.minWage && tax.nonExemptWeeklyMin;
  const currentYear = new Date().getFullYear();
  const savedYears = Object.keys(taxYears||{}).map(Number).sort();
  const displayYears = [...new Set([...savedYears, currentYear, currentYear+1])].sort();

  const addYear = (year) => {
    if (!taxYears?.[year]) {
      setTaxYears(prev=>({...prev,[year]:defaultTaxForYear(year)}));
    }
    setSelectedYear(year);
  };

  return (
    <div>
      <SHead title="Taxes & Regulations" sub="Payroll tax rates and overtime rules. Finalize each year before scheduling."/>

      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <Sub style={{margin:0}}>Tax Year</Sub>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {displayYears.map(y=>(
              <button key={y} onClick={()=>addYear(y)} style={{
                padding:"6px 18px",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer",
                border:`2px solid ${selectedYear===y?CN.orange:CN.border}`,
                backgroundColor:selectedYear===y?CN.orange:CN.white,
                color:selectedYear===y?CN.white:CN.dark,
                fontFamily:"'DM Sans',sans-serif",
              }}>
                {y}
                {taxYears?.[y]?.finalized&&<span style={{marginLeft:5,fontSize:10}}>✓</span>}
              </button>
            ))}
          </div>
          {!tax.finalized&&<span style={{fontSize:11,color:CN.mid}}>Not finalized</span>}
          {tax.finalized&&<span style={{fontSize:11,color:CN.green,fontWeight:700}}>✓ Finalized</span>}
        </div>
      </Card>

      {!tax.finalized&&(
        <Note type="warning">
          ⚠️ {selectedYear} settings not finalized. Complete all fields and click <strong>Finalize {selectedYear}</strong> to unlock cost calculations for weeks in {selectedYear}.
        </Note>
      )}
      {tax.finalized&&(
        <Note type="success">✓ {selectedYear} settings finalized. Cost calculations are active for weeks in {selectedYear}.</Note>
      )}

      <Card>
        <Sub>Federal Taxes — Employer Portion</Sub>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:"0 20px"}}>
          <Field label="Social Security (%)" type="number" value={tax.federalSS} step={0.01} onChange={v=>setTax(p=>({...p,federalSS:v}))} note="irs.gov — Pub 15"/>
          <Field label="Medicare (%)" type="number" value={tax.federalMedicare} step={0.01} onChange={v=>setTax(p=>({...p,federalMedicare:v}))} note="irs.gov — Pub 15"/>
          <Field label="FUTA (%)" type="number" value={tax.futa} step={0.01} onChange={v=>setTax(p=>({...p,futa:v}))} note="irs.gov"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"0 20px"}}>
          <Field label="SS Wage Base ($/yr)" type="number" value={tax.ssWageBase||176100} step={100} onChange={v=>setTax(p=>({...p,ssWageBase:v}))} note="irs.gov"/>
          <Field label="WA SUI Wage Base ($/yr)" type="number" value={tax.suiWageBase||72800} step={100} onChange={v=>setTax(p=>({...p,suiWageBase:v}))} note="esd.wa.gov"/>
        </div>
      </Card>

      <Card>
        <Sub>Washington State — Employer Portion</Sub>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"0 20px"}}>
          <Field label="WA SUI (%)" type="number" value={tax.waSUI} step={0.01} onChange={v=>setTax(p=>({...p,waSUI:v}))} note="esd.wa.gov"/>
          <Field label="WA L&I ($/hr worked)" type="number" value={tax.waLnI} step={0.01} onChange={v=>setTax(p=>({...p,waLnI:v}))} note="lni.wa.gov"/>
          <Field label="WA PFML Employer (%)" type="number" value={tax.waPFML} step={0.01} onChange={v=>setTax(p=>({...p,waPFML:v}))} note="paidleave.wa.gov"/>
          <Field label="WA Minimum Wage ($/hr)" type="number" value={tax.minWage} step={0.01} onChange={v=>setTax(p=>({...p,minWage:v}))} note="lni.wa.gov"/>
        </div>
      </Card>

      <Card>
        <Sub>Overtime & Exemption Rules</Sub>
        <Note>
          WA follows FLSA: OT required after <strong>40 hrs/week at 1.5×</strong> for non-exempt employees. WA has no daily OT requirement for adults. The daily max is a soft planning limit only.
        </Note>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:"0 20px",maxWidth:isMobile?"100%":"600px"}}>
          <Field label="Weekly OT Threshold (hrs)" type="number" value={ot.weeklyThreshold} step={1} min={1} onChange={v=>setOt(p=>({...p,weeklyThreshold:v}))}/>
          <Field label="OT Multiplier" type="number" value={ot.multiplier} step={0.1} min={1} onChange={v=>setOt(p=>({...p,multiplier:v}))}/>
          <Field label="Daily Max (soft, hrs)" type="number" value={ot.dailyMax} step={0.5} min={0} onChange={v=>setOt(p=>({...p,dailyMax:v}))} note="0 = disabled"/>
        </div>
        <div style={{maxWidth:isMobile?"100%":"300px"}}>
          <Field
            label={`WA Non-Exempt Salary Threshold ($/wk) — ${selectedYear}`}
            type="number" value={tax.nonExemptWeeklyMin||1332.80} step={0.01} min={0}
            onChange={v=>setTax(p=>({...p,nonExemptWeeklyMin:v}))}
            note="lni.wa.gov — update each year. Salaried roles below this threshold are forced nonexempt."
          />
        </div>
      </Card>

      <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap",marginBottom:"8px"}}>
        {!tax.finalized&&allFilled&&(
          <Btn onClick={()=>setTax(p=>({...p,finalized:true}))}>✓ Finalize {selectedYear}</Btn>
        )}
        {tax.finalized&&(
          <Btn variant="secondary" onClick={()=>setTax(p=>({...p,finalized:false}))}>Unlock {selectedYear} to Edit</Btn>
        )}
      </div>

      <SaveBar dirty={dirty} onSave={onSave} onClear={onClear} saving={saving} isMobile={isMobile}/>
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}


// ── Admin Tab ─────────────────────────────────────────────────────
function AdminTab({ currentUser, allUsers, admins, onPromote, onDemote, onRefresh, isMobile }) {
  const [expanded, setExpanded] = useState(null);        // userId whose scenarios are shown
  const [userScenarios, setUserScenarios] = useState({}); // {userId: {rs, ps}}
  const [loadingUser, setLoadingUser] = useState(null);
  const [renaming, setRenaming] = useState(null);         // {userId, type, scenarioId, name}
  const [confirmDelete, setConfirmDelete] = useState(null); // {userId, type, scenarioId, name}

  const isAdmin = id => admins.includes(id);
  const isSelf = id => id === currentUser.id;

  const loadUserScenarios = async (userId) => {
    if (userScenarios[userId]) { setExpanded(userId); return; }
    setLoadingUser(userId);
    const sk = userSK(userId);
    const rs = await loadS(sk.roleScenarios, null);
    const ps = await loadS(sk.planScenarios, null);
    setUserScenarios(prev => ({ ...prev, [userId]: { rs, ps } }));
    setExpanded(userId);
    setLoadingUser(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { userId, type, scenarioId } = confirmDelete;
    const sk = userSK(userId);
    const key = type === 'role' ? sk.roleScenarios : sk.planScenarios;
    const current = userScenarios[userId];
    const field = type === 'role' ? 'rs' : 'ps';
    const data = current[field];
    if (!data) return;
    const updated = { ...data, scenarios: data.scenarios.filter(s => s.id !== scenarioId) };
    if (updated.activeId === scenarioId) updated.activeId = updated.scenarios[0]?.id || null;
    await saveS(key, updated);
    setUserScenarios(prev => ({ ...prev, [userId]: { ...prev[userId], [field]: updated } }));
    setConfirmDelete(null);
  };

  const handleRename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    const { userId, type, scenarioId, name } = renaming;
    const sk = userSK(userId);
    const key = type === 'role' ? sk.roleScenarios : sk.planScenarios;
    const field = type === 'role' ? 'rs' : 'ps';
    const data = userScenarios[userId]?.[field];
    if (!data) return;
    const updated = { ...data, scenarios: data.scenarios.map(s => s.id === scenarioId ? { ...s, name: name.trim() } : s) };
    await saveS(key, updated);
    setUserScenarios(prev => ({ ...prev, [userId]: { ...prev[userId], [field]: updated } }));
    setRenaming(null);
  };

  const ScenarioList = ({ userId, type, scenarios }) => {
    const label = type === 'role' ? 'Role' : 'Schedule';
    const icon = type === 'role' ? '👥' : '📋';
    if (!scenarios?.length) return <div style={{ fontSize: 12, color: CN.mid, padding: '6px 0' }}>No {label.toLowerCase()} scenarios</div>;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: CN.mid, marginBottom: 6 }}>{icon} {label} Scenarios</div>
        {scenarios.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: CN.creamDark, borderRadius: 8, marginBottom: 4 }}>
            {renaming?.userId === userId && renaming?.type === type && renaming?.scenarioId === s.id ? (
              <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                <input autoFocus value={renaming.name} onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(null); }}
                  style={{ ...baseInp, fontSize: 12, padding: '4px 8px', flex: 1 }} />
                <button onClick={handleRename} style={{ fontSize: 11, padding: '4px 8px', backgroundColor: CN.orange, color: CN.white, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>Save</button>
                <button onClick={() => setRenaming(null)} style={{ fontSize: 11, padding: '4px 8px', backgroundColor: CN.creamDark, color: CN.mid, border: `1px solid ${CN.border}`, borderRadius: 6, cursor: 'pointer' }}>×</button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 13, color: CN.dark, fontWeight: 500 }}>{s.name}</span>
                <span style={{ fontSize: 11, color: CN.mid }}>{type === 'role' ? `${s.roles?.length || 0} roles` : `${[...new Set(s.plans?.map(p => p.weekOf) || [])].length} weeks`}</span>
                <button onClick={() => setRenaming({ userId, type, scenarioId: s.id, name: s.name })}
                  style={{ fontSize: 11, padding: '3px 8px', backgroundColor: CN.white, border: `1px solid ${CN.border}`, borderRadius: 6, cursor: 'pointer', color: CN.mid }}>Rename</button>
                <button onClick={() => setConfirmDelete({ userId, type, scenarioId: s.id, name: s.name })}
                  style={{ fontSize: 11, padding: '3px 8px', backgroundColor: CN.white, border: `1px solid ${CN.red}`, borderRadius: 6, cursor: 'pointer', color: CN.red }}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <SHead title="Admin Panel" sub={`${allUsers.length} user${allUsers.length !== 1 ? 's' : ''} · Manage scenarios and permissions`} />
        <Btn variant="secondary" onClick={onRefresh}>↻ Refresh</Btn>
      </div>

      {allUsers.length === 0 && <Note>No users have signed in yet. User records appear here after first sign-in.</Note>}

      {allUsers.map(u => {
        const isExpanded = expanded === u.id;
        const uScenarios = userScenarios[u.id];
        const loading = loadingUser === u.id;
        const uIsAdmin = isAdmin(u.id);
        const uIsSelf = isSelf(u.id);

        return (
          <Card key={u.id} style={{ marginBottom: 12, border: uIsSelf ? `2px solid ${CN.orange}` : `1.5px solid ${CN.border}` }}>
            {/* User header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {u.avatar
                ? <img src={u.avatar} alt={u.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: CN.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CN.white, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                    {(u.name?.[0] || '?').toUpperCase()}
                  </div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: CN.dark }}>{u.name}</span>
                  {uIsSelf && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: CN.orangeLight, color: CN.orange, padding: '1px 7px', borderRadius: 99 }}>You</span>}
                  {uIsAdmin && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: CN.purpleLight, color: CN.purple, padding: '1px 7px', borderRadius: 99 }}>Admin</span>}
                </div>
                <div style={{ fontSize: 12, color: CN.mid }}>{u.email}</div>
                {u.lastSeen && <div style={{ fontSize: 11, color: CN.mid }}>Last seen: {new Date(u.lastSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {/* Promote / demote — can't demote self (prevent lockout) */}
                {!uIsSelf && (
                  uIsAdmin
                    ? <Btn variant="secondary" onClick={() => onDemote(u.id)} style={{ fontSize: 11, padding: '5px 12px' }}>Remove Admin</Btn>
                    : <Btn variant="secondary" onClick={() => onPromote(u.id)} style={{ fontSize: 11, padding: '5px 12px' }}>Make Admin</Btn>
                )}
                <Btn variant="secondary" onClick={() => isExpanded ? setExpanded(null) : loadUserScenarios(u.id)} style={{ fontSize: 11, padding: '5px 12px' }}>
                  {loading ? 'Loading…' : isExpanded ? 'Hide' : 'View Scenarios'}
                </Btn>
              </div>
            </div>

            {/* Expanded scenario view */}
            {isExpanded && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${CN.border}` }}>
                {!uScenarios && <div style={{ color: CN.mid, fontSize: 13 }}>No data found for this user.</div>}
                {uScenarios && (
                  <>
                    <ScenarioList userId={u.id} type="role" scenarios={uScenarios.rs?.scenarios} />
                    <ScenarioList userId={u.id} type="plan" scenarios={uScenarios.ps?.scenarios} />
                  </>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: CN.white, borderRadius: 14, padding: 24, maxWidth: 360, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗑</div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 18, color: CN.dark, marginBottom: 8, textTransform: 'uppercase' }}>Delete Scenario</div>
            <p style={{ fontSize: 13, color: CN.mid, marginBottom: 20, lineHeight: 1.6 }}>
              Permanently delete <strong>"{confirmDelete.name}"</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={handleDelete} style={{ backgroundColor: CN.red }}>Delete</Btn>
              <Btn variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────
export default function App({ currentUser }) {
  const [tab,setTab]=useState("plan");
  const isMobile=useIsMobile();
  // Memoize SK so it's a stable object — without this, SK recreates every render
  // which cascades to migrate → loadAll → useEffect re-fires in a loop
  const SK = useMemo(() => userSK(currentUser.id), [currentUser.id]);

  // Guard: loadAll must only fire once on mount regardless of React StrictMode
  // double-invoke or any transient dep changes during initialisation
  const loadDone = useRef(false);

  // Scenario state
  const [roleScenarios,setRoleScenarios]=useState(null);
  const [planScenarios,setPlanScenarios]=useState(null);
  // Settings (shared) — taxYears is a map { [year]: taxObject }
  const [taxYears,setTaxYears]=useState(null);
  const [ot,setOt]=useState(null);
  // Saved snapshots
  const [savedRS,setSavedRS]=useState(null);
  const [savedPS,setSavedPS]=useState(null);
  const [savedTaxYears,setSavedTaxYears]=useState(null);
  const [savedOt,setSavedOt]=useState(null);
  // Tax year selector (lives in App so switching year in TaxTab doesn't re-mount)
  const [selectedTaxYear,setSelectedTaxYear]=useState(new Date().getFullYear());
  // Admin
  const [admins,setAdmins]=useState([]);       // array of userIds
  const [allUsers,setAllUsers]=useState([]);   // user registry
  const isAdmin = admins.includes(currentUser.id);
  const noAdminsYet = admins.length === 0;
  // DB timestamps
  const lastKnownAt=useRef({});
  // UI
  const [loading,setLoading]=useState(true);
  const [logoUrl,setLogoUrl]=useState(null);
  const [tabIcons,setTabIcons]=useState(DEFAULT_TAB_ICONS);
  const [showSystemTools,setShowSystemTools]=useState(false);
  const [saving,setSaving]=useState({roles:false,plans:false,settings:false});

  useEffect(()=>{
    const link=document.createElement("link");
    link.rel="stylesheet";
    link.href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    document.body.style.margin="0";document.body.style.padding="0";document.body.style.backgroundColor=CN.cream;
  },[]);

  // Register current user in shared registry
  const registerUser = useCallback(async () => {
    const registry = await loadS(SHARED_SK.userRegistry, []);
    const now = new Date().toISOString();
    const existing = registry.find(u => u.id === currentUser.id);
    const updated = existing
      ? registry.map(u => u.id === currentUser.id ? { ...u, lastSeen: now, name: currentUser.name, avatar: currentUser.avatar } : u)
      : [...registry, { ...currentUser, lastSeen: now }];
    await saveS(SHARED_SK.userRegistry, updated);
    return updated;
  // Use stable primitives, not the currentUser object itself
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id, currentUser.name, currentUser.email, currentUser.avatar]);

  // Migration: v2 shared → v3 per-user keys
  const migrate = useCallback(async () => {
    const defaultRoles = DEFAULT_ROLES.map(r => ({ ...r, exempt: r.payType === "Salary" }));
    const defaultRS = { scenarios: [makeRoleScenario("Default", defaultRoles, true)], activeId: null };
    defaultRS.activeId = defaultRS.scenarios[0].id;
    const defaultPS = { scenarios: [makePlanScenario("Default", defaultRS.scenarios[0].id, true)], activeId: null };
    defaultPS.activeId = defaultPS.scenarios[0].id;

    // Try shared key from previous version — stamp first scenario as default
    const sharedRS = await loadS(SK.sharedRoleScenarios, null);
    const sharedPS = await loadS(SK.sharedPlanScenarios, null);
    if (sharedRS) {
      const rs = { ...sharedRS, scenarios: sharedRS.scenarios.map((s,i)=>i===0?{...s,isDefault:true}:s) };
      const ps = sharedPS ? { ...sharedPS, scenarios: sharedPS.scenarios.map((s,i)=>i===0?{...s,isDefault:true}:s) } : defaultPS;
      return { rs, ps };
    }

    // Try legacy individual roles/plans
    const legacyRoles = await loadS(SK.legacyRoles, null);
    const legacyPlans = await loadS(SK.legacyPlans, null);
    if (legacyRoles) {
      const rs = { scenarios: [makeRoleScenario("Default", legacyRoles, true)], activeId: null };
      rs.activeId = rs.scenarios[0].id;
      const ps = { scenarios: [makePlanScenario("Default", rs.scenarios[0].id, true)], activeId: null };
      if (legacyPlans) ps.scenarios[0].plans = legacyPlans;
      ps.activeId = ps.scenarios[0].id;
      return { rs, ps };
    }
    return { rs: defaultRS, ps: defaultPS };
  }, [SK]);

  const loadAll = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);

    // Register user + load registry and admins in parallel
    const [updatedRegistry, adminList] = await Promise.all([
      registerUser(),
      loadS(SHARED_SK.admins, []),
    ]);
    setAllUsers(updatedRegistry);
    setAdmins(adminList);

    // Role scenarios (per-user)
    const rsData = await loadSWithTs(SK.roleScenarios, null);
    const psData = await loadSWithTs(SK.planScenarios, null);

    // Run migration once for both if either is missing (avoids double storage reads)
    let migrated = null;
    const getMigrated = async () => { if (!migrated) migrated = await migrate(); return migrated; };

    let rs = rsData.value;
    if (!rs) { rs = (await getMigrated()).rs; }
    setRoleScenarios(rs); setSavedRS(deepClone(rs)); lastKnownAt.current[SK.roleScenarios] = rsData.updated_at;

    let ps = psData.value;
    if (!ps) { ps = (await getMigrated()).ps; }
    setPlanScenarios(ps); setSavedPS(deepClone(ps)); lastKnownAt.current[SK.planScenarios] = psData.updated_at;

    // Tax years (shared) — migrate from old single-year format if needed
    const tyData = await loadSWithTs(SHARED_SK.taxYears, null);
    let ty = tyData.value;
    if (!ty) {
      // Migrate from old cn-hc-tax-v3 single-year format
      const oldTax = await loadS(SHARED_SK.tax, null);
      const year = new Date().getFullYear();
      ty = oldTax ? { [year]: { ...DEFAULT_TAX, ...oldTax } } : {};
    }
    setTaxYears(ty); setSavedTaxYears(deepClone(ty)); lastKnownAt.current[SHARED_SK.taxYears] = tyData.updated_at;

    const oData = await loadSWithTs(SHARED_SK.ot, DEFAULT_OT);
    const o = { ...DEFAULT_OT, ...oData.value };
    setOt(o); setSavedOt(deepClone(o)); lastKnownAt.current[SHARED_SK.ot] = oData.updated_at;

    // UI prefs
    const si = await loadS(SHARED_SK.icons, DEFAULT_TAB_ICONS);
    setTabIcons({ ...DEFAULT_TAB_ICONS, ...si });
    const sl = await loadS(SHARED_SK.logo, null);
    if (sl) setLogoUrl(sl);

    if (showLoader) setLoading(false);
  }, [SK, migrate, registerUser]);

  useEffect(() => {
    if (!loadDone.current) {
      loadDone.current = true;
      loadAll();
    }
  }, [loadAll]);

  // Auto-save UI prefs
  useEffect(() => { saveS(SHARED_SK.icons, tabIcons); }, [tabIcons]);
  useEffect(() => { if (logoUrl !== null) saveS(SHARED_SK.logo, logoUrl); }, [logoUrl]);

  // ── Save helpers ────────────────────────────────────────────────
  const doSave = useCallback(async (section, items) => {
    setSaving(s => ({ ...s, [section]: true }));
    for (const item of items) {
      const result = await window.storage.checkAndSet(item.key, JSON.stringify(item.val), lastKnownAt.current[item.key]);
      if (!result) { setSaving(s => ({ ...s, [section]: false })); return; }
      if (result.conflict) await saveS(item.key, item.val); // silent overwrite
      item.setSaved(deepClone(item.val));
      lastKnownAt.current[item.key] = result.updated_at || new Date().toISOString();
    }
    setSaving(s => ({ ...s, [section]: false }));
  }, []);

  const saveRoles = () => doSave("roles", [{ key: SK.roleScenarios, val: roleScenarios, setSaved: setSavedRS }]);
  const savePlans = () => doSave("plans", [{ key: SK.planScenarios, val: planScenarios, setSaved: setSavedPS }]);
  const saveSettings = () => doSave("settings", [{ key: SHARED_SK.taxYears, val: taxYears, setSaved: setSavedTaxYears }, { key: SHARED_SK.ot, val: ot, setSaved: setSavedOt }]);

  const clearRoles = () => setRoleScenarios(deepClone(savedRS));
  const clearPlansWeek = (weekOf) => {
    setPlanScenarios(prev => ({
      ...prev,
      scenarios: prev.scenarios.map(s => s.id === prev.activeId ? {
        ...s,
        plans: [
          ...s.plans.filter(p => p.weekOf !== weekOf),
          ...(savedPS.scenarios.find(ss => ss.id === prev.activeId)?.plans.filter(p => p.weekOf === weekOf) || [])
        ]
      } : s)
    }));
  };
  const clearSettings = () => { setTaxYears(deepClone(savedTaxYears)); setOt(deepClone(savedOt)); };

  // Admin actions
  const claimAdmin = async () => {
    const updated = [currentUser.id];
    await saveS(SHARED_SK.admins, updated);
    setAdmins(updated);
  };
  const promoteUser = async (userId) => {
    const updated = [...admins, userId];
    await saveS(SHARED_SK.admins, updated);
    setAdmins(updated);
  };
  const demoteUser = async (userId) => {
    const updated = admins.filter(id => id !== userId);
    await saveS(SHARED_SK.admins, updated);
    setAdmins(updated);
  };

  // Dirty flags
  const rolesDirty = !!savedRS && JSON.stringify(roleScenarios) !== JSON.stringify(savedRS);
  const plansDirty = !!savedPS && JSON.stringify(planScenarios) !== JSON.stringify(savedPS);
  const settingsDirty = !!savedTaxYears && (JSON.stringify(taxYears) !== JSON.stringify(savedTaxYears) || JSON.stringify(ot) !== JSON.stringify(savedOt));

  const TABS = [
    { id: "roles",   label: "Job Roles",      icon: tabIcons.roles,   dirty: rolesDirty },
    { id: "plan",    label: "Schedule",        icon: tabIcons.plan,    dirty: plansDirty },
    { id: "summary", label: "Summary",         icon: tabIcons.summary, dirty: false },
    { id: "settings",label: "Taxes & Regs",   icon: "⚖️",             dirty: settingsDirty },
    ...(isAdmin ? [{ id: "admin", label: "Admin", icon: "🔐", dirty: false }] : []),
  ];

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: CN.cream }}>
      <div style={{ color: CN.mid, fontSize: "14px", fontFamily: "sans-serif" }}>Loading…</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",backgroundColor:CN.cream,fontFamily:"'DM Sans',sans-serif"}}>

      {/* Claim admin banner — only shown when no admins exist yet */}
      {noAdminsYet && (
        <div style={{backgroundColor:CN.amberLight,borderBottom:`1px solid ${CN.amber}`,padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <span style={{fontSize:13,color:"#92400E",fontWeight:500}}>⚠️ No admin has been set up for this tool yet.</span>
          <button onClick={claimAdmin} style={{padding:"6px 16px",backgroundColor:CN.amber,color:CN.white,border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>
            Claim Admin Access
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{background:`linear-gradient(135deg,${CN.orange} 0%,#FF5722 100%)`,padding:isMobile?"10px 14px":"14px 24px",boxShadow:"0 2px 12px rgba(244,58,10,0.25)"}}>
        <div style={{maxWidth:"1200px",margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
            <div onClick={()=>document.getElementById("cn-logo-upload").click()} title="Click to upload logo"
              style={{width:isMobile?36:52,height:isMobile?36:52,borderRadius:8,border:"2px dashed rgba(255,255,255,0.5)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",backgroundColor:"rgba(255,255,255,0.12)",flexShrink:0}}>
              {logoUrl?<img src={logoUrl} alt="Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<span style={{fontSize:isMobile?"16px":"22px",opacity:0.65}}>🏢</span>}
            </div>
            <input id="cn-logo-upload" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>setLogoUrl(ev.target.result);reader.readAsDataURL(file);e.target.value="";}}/>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:isMobile?"16px":"22px",letterSpacing:"0.08em",textTransform:"uppercase",color:CN.white,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {isMobile?"CN · Headcount":"Cheeky Noodles · Headcount Planner"}
              </div>
              {!isMobile&&<div style={{fontSize:"11px",color:"rgba(255,255,255,0.75)",marginTop:"2px"}}>Standalone labor planning tool · Data persists between sessions</div>}
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:isMobile?8:16,flexShrink:0}}>
            {!isMobile&&<div style={{textAlign:"right",fontSize:"12px",color:"rgba(255,255,255,0.8)"}}>
              <div>{roleScenarios?.scenarios.length||0} role scenario{roleScenarios?.scenarios.length!==1?"s":""}</div>
              <div>{planScenarios?.scenarios.length||0} schedule scenario{planScenarios?.scenarios.length!==1?"s":""}</div>
            </div>}

            <div style={{position:"relative"}}>
              <button onClick={()=>setShowSystemTools(v=>!v)}
                style={{background:"rgba(255,255,255,0.18)",border:"1px solid rgba(255,255,255,0.38)",borderRadius:8,padding:"7px 13px",color:CN.white,cursor:"pointer",fontSize:"13px",fontWeight:600,fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                🛠️{!isMobile&&" System Tools"}
              </button>
              {showSystemTools&&(
                <>
                  <div style={{position:"fixed",inset:0,zIndex:999}} onClick={()=>setShowSystemTools(false)}/>
                  <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:310,backgroundColor:CN.white,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.18)",border:`1px solid ${CN.border}`,zIndex:1000,overflow:"hidden"}}>
                    <div style={{padding:"11px 16px",backgroundColor:CN.creamDark,borderBottom:`1px solid ${CN.border}`,fontWeight:700,fontSize:"13px",color:CN.dark}}>🛠️ System Tools</div>
                    <div style={{padding:"14px 16px",borderBottom:`1px solid ${CN.border}`}}>
                      <div style={{fontSize:"11px",fontWeight:600,color:CN.mid,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Logo</div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:44,height:44,borderRadius:6,border:`1px solid ${CN.border}`,overflow:"hidden",backgroundColor:CN.creamDark,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {logoUrl?<img src={logoUrl} alt="Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<span style={{fontSize:"20px",opacity:0.4}}>🏢</span>}
                        </div>
                        <div style={{flex:1}}>
                          <button onClick={()=>document.getElementById("cn-logo-upload").click()} style={{fontSize:"12px",padding:"5px 10px",borderRadius:6,border:`1px solid ${CN.border}`,backgroundColor:CN.white,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",color:CN.dark,display:"block",width:"100%",marginBottom:4}}>{logoUrl?"Replace logo":"Upload logo"}</button>
                          {logoUrl&&<button onClick={()=>setLogoUrl(null)} style={{fontSize:"11px",padding:"4px 10px",borderRadius:6,border:`1px solid ${CN.border}`,backgroundColor:CN.white,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",color:CN.red,display:"block",width:"100%"}}>Remove logo</button>}
                        </div>
                      </div>
                    </div>
                    <div style={{padding:"14px 16px"}}>
                      <div style={{fontSize:"11px",fontWeight:600,color:CN.mid,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Navigation Icons</div>
                      {[
                        {id:"roles",  label:"Job Roles",  options:["👥","👤","🧑‍💼","👷","🧑‍🍳","🤝","🏢","🎭"]},
                        {id:"plan",   label:"Schedule",   options:["📋","📅","🗓️","📆","🗒️","📝","⏰","🗂️"]},
                        {id:"summary",label:"Summary",    options:["📊","📈","📉","💼","🧾","📄","💰","🔍"]},
                      ].map(row=>(
                        <div key={row.id} style={{marginBottom:12}}>
                          <div style={{fontSize:"12px",color:CN.dark,marginBottom:6,fontWeight:500}}>{row.label}</div>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            {row.options.map(icon=>(
                              <button key={icon} onClick={()=>setTabIcons(prev=>({...prev,[row.id]:icon}))}
                                style={{fontSize:"17px",padding:"4px 7px",borderRadius:6,border:tabIcons[row.id]===icon?`2px solid ${CN.orange}`:"2px solid transparent",backgroundColor:tabIcons[row.id]===icon?CN.orangeLight:"transparent",cursor:"pointer"}}>{icon}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{backgroundColor:CN.white,borderBottom:`1.5px solid ${CN.border}`}}>
        <div style={{maxWidth:"1200px",margin:"0 auto",display:"flex",overflowX:"auto"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:isMobile?"10px 14px":"12px 22px",fontSize:isMobile?"12px":"13px",fontWeight:600,border:"none",cursor:"pointer",
                borderBottom:tab===t.id?`3px solid ${CN.orange}`:"3px solid transparent",
                color:tab===t.id?CN.orange:CN.mid,backgroundColor:"transparent",
                fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
              {t.icon} {t.label}
              {t.dirty&&<span style={{width:"6px",height:"6px",borderRadius:"50%",backgroundColor:CN.orange,display:"inline-block",marginLeft:5,verticalAlign:"middle"}}/>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:"1200px",margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>
        {tab==="roles"&&roleScenarios&&<RolesTab
          roleScenarios={roleScenarios} setRoleScenarios={setRoleScenarios}
          taxYears={taxYears} ot={ot} isAdmin={isAdmin}
          dirty={rolesDirty} onSave={saveRoles} onClear={clearRoles} saving={saving.roles} isMobile={isMobile}
        />}
        {tab==="plan"&&planScenarios&&roleScenarios&&<PlanTab
          roleScenarios={roleScenarios} planScenarios={planScenarios} setPlanScenarios={setPlanScenarios}
          taxYears={taxYears} ot={ot} isAdmin={isAdmin}
          dirty={plansDirty} onSave={savePlans} onClear={clearPlansWeek} saving={saving.plans} isMobile={isMobile}
        />}
        {tab==="summary"&&<SummaryTab
          roleScenarios={roleScenarios||{scenarios:[]}} planScenarios={planScenarios||{scenarios:[]}}
          taxYears={taxYears} ot={ot} onRefresh={()=>loadAll(false)}
        />}
        {tab==="settings"&&taxYears&&ot&&<TaxTab
          taxYears={taxYears} setTaxYears={setTaxYears}
          selectedYear={selectedTaxYear} setSelectedYear={setSelectedTaxYear}
          ot={ot} setOt={setOt}
          dirty={settingsDirty} onSave={saveSettings} onClear={clearSettings} saving={saving.settings} isMobile={isMobile}
        />}
        {tab==="admin"&&isAdmin&&<AdminTab
          currentUser={currentUser}
          allUsers={allUsers}
          admins={admins}
          onPromote={promoteUser}
          onDemote={demoteUser}
          onRefresh={()=>loadAll(false)}
          isMobile={isMobile}
        />}
      </div>
    </div>
  );
}