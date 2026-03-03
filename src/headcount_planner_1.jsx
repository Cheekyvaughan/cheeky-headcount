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
  // Red (Primary) — brand, CTAs, header
  orange: "#FF3B00", orangeHover: "#D93200", orangeLight: "#FFEDE8",
  // Cream (Primary) — backgrounds
  cream: "#FBF5DF", creamDark: "#EFE7C8",
  // Black + Slate — text
  dark: "#3C3C37", mid: "#494843",
  // Grey — structure
  border: "#EAE6E5", white: "#FFFFFF",
  // Yellow — warnings
  amber: "#F0B030", amberLight: "#FFF5CC", amberDark: "#C88800",
  // Red dark — errors
  red: "#CC2800", redLight: "#FFE0D8",
  // Jungle — info, comparison, positive
  blue: "#09A387", blueLight: "#D0EFE8",
  green: "#078A72", greenLight: "#D0EFE8",
  // Slate-toned — exempt badges (no purple in brand palette)
  purple: "#494843", purpleLight: "#E8E6DF",
};

// ── Defaults ──────────────────────────────────────────────────────
// Per-year tax template — clone and adjust when adding a new year
function defaultTaxForYear(year) {
  return {
    federalSS: 6.2, federalMedicare: 1.45, futa: 0.6,
    waSUI: 1.2, waLnI: 1.85, waPFML: 0,
    ssWageBase: 176100, suiWageBase: 72800,
    minWage: 16.66, minWageMinor: 0, nonExemptWeeklyMin: 1332.80,
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
    // Minors: effective rate is max(role.rate, minWageMinor) when minWageMinor is set
    const effectiveRate = (role.isMinor && T.minWageMinor > 0)
      ? Math.max(role.rate, T.minWageMinor)
      : role.rate;
    const reg = Math.min(totalHrs, O.weeklyThreshold);
    otHrs = role.otEligible ? Math.max(0, totalHrs - O.weeklyThreshold) : 0;
    wages = reg*effectiveRate + otHrs*effectiveRate*O.multiplier;
    otPremium = otHrs*effectiveRate*(O.multiplier-1);
  } else {
    // Salary
    const weeklyRate = role.rate / 4.33;
    if (role.exempt) {
      wages = weeklyRate;
    } else {
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

const MINOR_WEEKLY_MAX = 40; // WA: under-16 hard cap — RCW 49.12

function rowStatus(role, dayHours, ot) {
  const O = ot||DEFAULT_OT;
  const totalHrs = DAYS.reduce((s,d)=>s+(parseFloat(dayHours[d])||0),0);
  const maxDay = Math.max(...DAYS.map(d=>parseFloat(dayHours[d])||0));
  if (role.isMinor && totalHrs > MINOR_WEEKLY_MAX) return "minormax";
  if (O.dailyMax>0 && maxDay>O.dailyMax) return "daymax";
  const otApplies = role.payType==="Hourly" ? role.otEligible : !role.exempt;
  if (otApplies && totalHrs>O.weeklyThreshold) return "ot";
  if (otApplies && totalHrs>=O.weeklyThreshold*0.85) return "nearot";
  return "ok";
}

const STATUS = {
  ok:       { rowBg:"transparent",  icon:null,  },
  nearot:   { rowBg:"#FFFDF0",      icon:"🔶",  },
  ot:       { rowBg:"#FFF5CC",      icon:"⚠️",  },
  daymax:   { rowBg:"#FFE0D8",      icon:"🚨",  label:"Potential Max Time" },
  minormax: { rowBg:"#FFE0D8",      icon:"🔞",  },
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
            backgroundColor:confirmClear?"#FFE0D8":CN.white,color:confirmClear?CN.red:CN.mid,
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
function ScenarioSelector({ scenarios, activeId, onSwitch, onCreate, onDelete, onRename, canRename, label="Scenario" }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const active = scenarios.find(s=>s.id===activeId);
  const startRename = (s) => { setRenamingId(s.id); setRenameVal(s.name); setConfirmDelete(null); };
  const commitRename = (id) => { if(renameVal.trim()&&onRename) onRename(id,renameVal.trim()); setRenamingId(null); };

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
          <div style={{position:"fixed",inset:0,zIndex:200}} onClick={()=>{setOpen(false);setRenamingId(null);}}/>
          <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:"220px",backgroundColor:CN.white,
            borderRadius:"10px",boxShadow:"0 8px 32px rgba(0,0,0,0.15)",border:`1px solid ${CN.border}`,zIndex:201,overflow:"hidden"}}>
            {scenarios.map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"8px 10px",backgroundColor:s.id===activeId?CN.orangeLight:"transparent",
                borderBottom:`1px solid ${CN.creamDark}`,gap:"6px"}}>
                {renamingId===s.id
                  ? <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")commitRename(s.id);if(e.key==="Escape")setRenamingId(null);}}
                      onBlur={()=>commitRename(s.id)}
                      style={{flex:1,fontSize:"13px",fontFamily:"'DM Sans',sans-serif",padding:"2px 6px",borderRadius:4,border:`1.5px solid ${CN.orange}`,outline:"none"}}/>
                  : <button onClick={()=>{onSwitch(s.id);setOpen(false);setRenamingId(null);}}
                      style={{flex:1,textAlign:"left",background:"none",border:"none",cursor:"pointer",
                        fontSize:"13px",fontWeight:s.id===activeId?700:400,color:s.id===activeId?CN.orange:CN.dark,
                        fontFamily:"'DM Sans',sans-serif",padding:0}}>
                      {s.id===activeId?"✓ ":""}{s.name}
                    </button>
                }
                <div style={{display:"flex",gap:3,flexShrink:0}}>
                  {renamingId!==s.id&&onRename&&(!canRename||canRename(s.id))&&(
                    <button onClick={e=>{e.stopPropagation();startRename(s);}}
                      style={{fontSize:"11px",color:CN.mid,background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:4}}
                      title="Rename">✏️</button>
                  )}
                  {scenarios.length>1&&(
                    confirmDelete===s.id
                      ? <div style={{display:"flex",gap:"4px"}}>
                          <button onClick={()=>{onDelete(s.id);setConfirmDelete(null);setOpen(false);}}
                            style={{fontSize:"10px",padding:"2px 6px",backgroundColor:CN.red,color:CN.white,border:"none",borderRadius:"4px",cursor:"pointer"}}>Delete</button>
                          <button onClick={()=>setConfirmDelete(null)}
                            style={{fontSize:"10px",padding:"2px 6px",backgroundColor:CN.creamDark,color:CN.mid,border:"none",borderRadius:"4px",cursor:"pointer"}}>Cancel</button>
                        </div>
                      : <button onClick={()=>{setConfirmDelete(s.id);setRenamingId(null);}}
                          style={{fontSize:"11px",color:CN.mid,background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:"4px"}}
                          title="Delete scenario">🗑</button>
                  )}
                </div>
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
  const blank={name:"",category:"BOH",payType:"Hourly",rate:"",defaultHours:35,otEligible:true,exempt:false,isMinor:false,benefits:{...DEFAULT_BENEFITS},active:true};
  const [f,setF]=useState(initial?{...initial,benefits:{...DEFAULT_BENEFITS,...(initial.benefits||{})}}:blank);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const setB=(k,v)=>setF(p=>({...p,benefits:{...p.benefits,[k]:v}}));

  const activeTax = taxForYear || DEFAULT_TAX;
  const taxOk = activeTax?.finalized !== false;

  // Minor wage validation — only relevant for hourly
  const minorWageSet = activeTax.minWageMinor > 0;
  const effectiveMinWage = f.isMinor && minorWageSet ? activeTax.minWageMinor : activeTax.minWage || DEFAULT_TAX.minWage;
  const minW = f.payType==="Hourly" && Number(f.rate)>0 && Number(f.rate) < effectiveMinWage;
  // Minors cannot be salaried (not eligible for WA exemption under 18)
  const minorBlocksSalary = f.isMinor && f.payType==="Salary";

  // Auto-exempt logic: derive from salary amount
  const exemptThreshold = ot?.nonExemptWeeklyMin || DEFAULT_OT.nonExemptWeeklyMin;
  const weeklyEquiv = f.payType==="Salary" ? (Number(f.rate)||0) / 4.33 : null;
  const forcedNonExempt = f.payType==="Salary" && weeklyEquiv !== null && weeklyEquiv < exemptThreshold;
  const effectiveExempt = forcedNonExempt ? false : f.exempt;

  const valid = f.name.trim() && f.rate!=="" && Number(f.rate)>0 && taxOk && !minorBlocksSalary;
  const previewDays = DAYS.reduce((a,d,i)=>({...a,[d]:i<5?(f.defaultHours||0)/5:0}),{});
  const prev = f.name.trim()&&f.rate!==""&&Number(f.rate)>0 ? calcRowCost({...f,exempt:effectiveExempt,rate:Number(f.rate)},previewDays,activeTax,ot) : null;

  const handlePayType = (v) => {
    set("payType",v);
    if (v==="Salary") { set("otEligible",false); set("exempt",true); }
    else { set("otEligible",true); set("exempt",false); }
  };

  const handleMinorToggle = (checked) => {
    set("isMinor", checked);
    // Minors must be hourly — revert salary if toggled on
    if (checked && f.payType==="Salary") {
      set("payType","Hourly"); set("otEligible",true); set("exempt",false);
    }
  };

  return (
    <Card style={{border:`1.5px solid ${CN.orange}`,marginBottom:"12px"}}>
      <Sub>{initial?"Edit Role":"Add New Role"}</Sub>
      {!taxOk&&<Note type="alert">⚠️ Finalize Tax & Regulations settings before adding roles — tax rates affect cost calculations.</Note>}
      {minW&&<Note type="alert">⚠️ Rate ${f.rate}/hr is below the {f.isMinor?"minor":"WA"} minimum wage of ${effectiveMinWage}/hr. lni.wa.gov</Note>}
      {minorBlocksSalary&&<Note type="alert">⚠️ Workers under 16 cannot hold salaried-exempt positions under WA law. Switch to Hourly.</Note>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <div style={{gridColumn:"1/-1"}}><Field label="Job Title" value={f.name} onChange={v=>set("name",v)} placeholder="e.g. Line Cook"/></div>
        <Pick label="Category" value={f.category} onChange={v=>set("category",v)} options={CATEGORIES}/>
        <Pick label="Pay Type" value={f.payType} onChange={handlePayType} options={f.isMinor?["Hourly"]:PAY_TYPES}/>
        <Field label={f.payType==="Hourly"?"Hourly Rate ($)":"Monthly Salary ($)"} type="number" value={f.rate} onChange={v=>set("rate",v)} min={0} step={0.5}/>
        {f.payType==="Hourly"&&<Field label="Default Hrs/Week" type="number" value={f.defaultHours} onChange={v=>set("defaultHours",v)} min={0} max={f.isMinor?MINOR_WEEKLY_MAX:undefined} step={1}/>}
      </div>

      {/* Minor toggle */}
      <div style={{marginBottom:"12px",padding:"12px 14px",backgroundColor:f.isMinor?CN.amberLight:CN.creamDark,borderRadius:8,border:`1px solid ${f.isMinor?CN.amber:CN.border}`}}>
        <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
          <input type="checkbox" checked={!!f.isMinor} onChange={e=>handleMinorToggle(e.target.checked)}
            style={{width:15,height:15,accentColor:CN.amber}}/>
          <div>
            <div style={{fontWeight:700,fontSize:"13px",color:CN.dark}}>Minor (under 16)</div>
            <div style={{fontSize:"11px",color:CN.mid,marginTop:2}}>
              Caps weekly hours at {MINOR_WEEKLY_MAX}h. Applies minor minimum wage if set.{f.isMinor&&minorWageSet?` Effective rate: $${effectiveMinWage}/hr min.`:""} lni.wa.gov
            </div>
          </div>
        </label>
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

      {/* Minor toggle — only relevant for hourly roles */}
      {f.payType==="Hourly"&&(
        <div style={{marginBottom:"12px",padding:"12px 14px",backgroundColor:f.isMinor?CN.amberLight:"transparent",border:`1px solid ${f.isMinor?CN.amber:CN.border}`,borderRadius:8}}>
          <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
            <input type="checkbox" checked={!!f.isMinor} onChange={e=>set("isMinor",e.target.checked)}
              style={{width:15,height:15,marginTop:2,accentColor:CN.amber,flexShrink:0}}/>
            <div>
              <div style={{fontWeight:600,fontSize:13,color:CN.dark}}>Role occupied by a minor (&lt;16 years)</div>
              <div style={{fontSize:11,color:CN.mid,marginTop:2}}>
                Applies WA minor minimum wage if set. Enforces the {MINOR_WEEKLY_MAX}-hour weekly hard cap (RCW 49.12). Schedule will block hours above this limit.
                {activeTax?.minWageMinor>0&&<span style={{marginLeft:4,fontWeight:600,color:"#92400E"}}>Minor rate: {fmt$(activeTax.minWageMinor)}/hr for this year.</span>}
              </div>
            </div>
          </label>
        </div>
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
          onRename={(id,name)=>setRoleScenarios(prev=>{const target=prev.scenarios.find(s=>s.id===id);if(target?.isDefault&&!isAdmin)return prev;return{...prev,scenarios:prev.scenarios.map(s=>s.id===id?{...s,name}:s)};})}
          canRename={id=>{const s=roleScenarios.scenarios.find(x=>x.id===id);return !s?.isDefault||isAdmin;}}
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
                        {role.isMinor&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:"#FFF5CC",color:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>⚠ Minor &lt;16</span>}
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
                      <Btn variant="ghost" onClick={()=>{if(!readOnly)setEditing(role.id);}} style={{opacity:readOnly?0.3:1,cursor:readOnly?"not-allowed":"pointer",pointerEvents:readOnly?"none":"auto"}}>Edit</Btn>
                      <Btn variant="ghost" onClick={()=>{if(!readOnly)toggle(role.id);}} style={{color:CN.mid,opacity:readOnly?0.3:1,cursor:readOnly?"not-allowed":"pointer",pointerEvents:readOnly?"none":"auto"}}>{role.active?"Deactivate":"Activate"}</Btn>
                      <Btn variant="danger" onClick={()=>{if(!readOnly)remove(role.id);}} style={{opacity:readOnly?0.3:1,cursor:readOnly?"not-allowed":"pointer",pointerEvents:readOnly?"none":"auto"}}>Remove</Btn>
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
    // Minor hard cap: total across the week cannot exceed MINOR_WEEKLY_MAX
    // Calculate what the new weekly total would be and clamp if minor role
    updatePlans(ps=>ps.map(p=>{
      if(p.id!==planId) return p;
      const role=availableRoles.find(r=>r.id===p.roleId);
      if(role?.isMinor && num!==""){
        const otherDaysTotal=DAYS.filter(d=>d!==day).reduce((s,d)=>s+(parseFloat(p.days[d])||0),0);
        const allowed=Math.max(0, MINOR_WEEKLY_MAX - otherDaysTotal);
        return {...p,days:{...p.days,[day]:Math.min(num,allowed)}};
      }
      return {...p,days:{...p.days,[day]:num}};
    }));
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
            onRename={(id,name)=>setPlanScenarios(prev=>{const target=prev.scenarios.find(s=>s.id===id);if(target?.isDefault&&!isAdmin)return prev;return{...prev,scenarios:prev.scenarios.map(s=>s.id===id?{...s,name}:s)};})}
            canRename={id=>{const s=planScenarios.scenarios.find(x=>x.id===id);return !s?.isDefault||isAdmin;}}
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
            {[["#FFFDF0","🔶",`Approaching OT (≥${Math.round(O.weeklyThreshold*0.85)}h)`],["#FFF5CC","⚠️",`Overtime (>${O.weeklyThreshold}h/week)`],["#FFE0D8","🚨",`Daily max exceeded (>${O.dailyMax}h/day)`]].map(([bg,icon,label])=>(
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
                                      {STATUS[st].icon&&<span>{STATUS[st].icon}</span>}{role.name} <span style={{fontSize:"11px",color:CN.mid,fontWeight:400}}>#{empIdx+1}</span>{STATUS[st].label&&st!=="ok"&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:"#FFE0D8",color:CN.red,padding:"1px 6px",borderRadius:99,marginLeft:4}}>{STATUS[st].label}</span>}
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
                                    style={{flex:1,textAlign:"center",border:`1.5px solid ${overDay?CN.red:CN.border}`,borderRadius:"8px",padding:"10px",fontSize:"18px",fontWeight:700,fontFamily:"'DM Sans',sans-serif",backgroundColor:overDay?"#FFE0D8":CN.white,color:overDay?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}
                                  />
                                  <button onClick={()=>{if(!readOnly)removeRow(plan.id);}} style={{border:`1px solid ${CN.border}`,background:CN.white,cursor:"pointer",color:CN.mid,fontSize:"13px",padding:"8px 10px",borderRadius:"8px"}}>✕</button>
                                </div>
                                <div style={{display:"flex",gap:"12px",marginTop:"8px",flexWrap:"wrap"}}>
                                  <span style={{fontSize:"11px",color:CN.mid}}>Week: <strong style={{color:CN.dark}}>{cost.totalHrs>0?cost.totalHrs.toFixed(1)+"h":"—"}</strong></span>
                                  {cost.otHrs>0&&<span style={{fontSize:"11px",color:CN.amberDark,fontWeight:700}}>⚡ {cost.otHrs.toFixed(1)}h OT (+{fmt$(cost.otPremium)})</span>}
                                </div>
                              </div>
                            );
                          })}
                          <button onClick={()=>{if(!readOnly)addRow(role.id);}} style={{border:`1px dashed ${CN.orange}`,background:"none",cursor:"pointer",color:CN.orange,fontSize:"12px",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",padding:"8px 14px",borderRadius:"8px",width:"100%",marginBottom:"8px"}}>
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
                                        {role.isMinor&&<span style={{fontSize:"9px",fontWeight:700,backgroundColor:"#FFF5CC",color:"#92400E",padding:"1px 5px",borderRadius:99}}>Minor</span>}
                                      </div>
                                      <div style={{fontSize:"10px",color:CN.mid}}>
                                        #{empIdx+1} · {role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo`}
                                        {role.payType==="Salary"&&<span style={{marginLeft:"4px",color:role.exempt?CN.purple:CN.amberDark}}>({role.exempt?"exempt":"nonexempt"})</span>}
                                        {role.isMinor&&<span style={{marginLeft:4,color:st==="minormax"?CN.red:CN.mid}}> · {Math.max(0,MINOR_WEEKLY_MAX-cost.totalHrs).toFixed(1)}h left this wk</span>}
                                      </div>
                                      {cost.otHrs>0&&<div style={{fontSize:"10px",color:CN.amberDark,fontWeight:700}}>+{cost.otHrs.toFixed(1)}h OT · +{fmt$(cost.otPremium)}</div>}
                                    </div>
                                    <button onClick={()=>{if(!readOnly)removeRow(plan.id);}} style={{border:"none",background:"none",cursor:"pointer",color:CN.border,fontSize:"13px",padding:"0",lineHeight:1}}>✕</button>
                                  </div>
                                </td>
                              {DAYS.map(d=>{
                                  const h=plan.days[d]; const hNum=parseFloat(h)||0;
                                  const overDay=O.dailyMax>0&&hNum>O.dailyMax;
                                  // For minors: show remaining capacity in cell title; tint at-cap cells
                                  const otherDaysTotal=role.isMinor?DAYS.filter(dd=>dd!==d).reduce((s,dd)=>s+(parseFloat(plan.days[dd])||0),0):0;
                                  const minorAtCap=role.isMinor&&(otherDaysTotal+hNum)>=MINOR_WEEKLY_MAX;
                                  const cellRed=overDay||minorAtCap;
                                  return (
                                    <td key={d} style={{...TD,padding:"5px 4px"}}>
                                      <input type="number" min={0} max={role.isMinor?Math.max(0,MINOR_WEEKLY_MAX-(otherDaysTotal)):24} step={0.5} value={h} placeholder="–"
                                        title={role.isMinor?`Minor: ${Math.max(0,MINOR_WEEKLY_MAX-otherDaysTotal-hNum).toFixed(1)}h remaining this week`:""}
                                        onChange={e=>updateDay(plan.id,d,e.target.value)}
                                        style={{width:"100%",textAlign:"center",border:`1.5px solid ${cellRed?CN.red:hNum>0?CN.border:CN.creamDark}`,borderRadius:"6px",padding:"6px 2px",fontSize:"13px",fontFamily:"'DM Sans',sans-serif",backgroundColor:cellRed?"#FFE0D8":hNum>0?CN.white:CN.creamDark,color:cellRed?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}
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
                              <button onClick={()=>{if(!readOnly)addRow(role.id);}} style={{border:"none",background:"none",cursor:"pointer",color:CN.orange,fontSize:"11px",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em",padding:"5px 8px",borderRadius:"6px"}}>
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
                {(()=>{
                  const BAR_H=120;
                  const colors=[CN.orange,CN.blue,CN.purple,CN.green,"#EC4899"];
                  const maxVal=Math.max(...compareData.map(x=>x.grandTotal.total),1);
                  return (
                    <div style={{display:"flex",gap:"16px",alignItems:"flex-end",height:`${BAR_H+48}px`,paddingTop:"24px"}}>
                      {compareData.map((s,i)=>{
                        const c=colors[i%colors.length];
                        const barH=Math.max(Math.round((s.grandTotal.total/maxVal)*BAR_H),4);
                        return (
                          <div key={s.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:0,flex:1,minWidth:0}}>
                            <div style={{fontSize:"11px",fontWeight:700,color:c,marginBottom:4,textAlign:"center"}}>{fmt$(s.grandTotal.total)}</div>
                            <div style={{width:"100%",maxWidth:"80px",backgroundColor:c,borderRadius:"6px 6px 0 0",height:`${barH}px`,transition:"height 0.3s ease"}}/>
                            <div style={{fontSize:"10px",color:CN.mid,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%",marginTop:6,paddingTop:4,borderTop:`2px solid ${CN.border}`,width:"100%"}}>{s.name}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
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
          <Field label="WA Minimum Wage — Adult ($/hr)" type="number" value={tax.minWage} step={0.01} onChange={v=>setTax(p=>({...p,minWage:v}))} note="lni.wa.gov"/>
          <Field label="WA Minimum Wage — Minor under 16 ($/hr)" type="number" value={tax.minWageMinor||""} placeholder="0 = same as adult" step={0.01} min={0} onChange={v=>setTax(p=>({...p,minWageMinor:v===""?0:v}))} note="lni.wa.gov — WA allows 85% of adult min wage for minors. Leave blank or 0 if not applicable."/>
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

// ── Forecaster Tab ────────────────────────────────────────────────
const FORECAST_BENCHMARKS = {
  // role name keyword → { revenuePerHr, coversPerHr, floor, source, sourceUrl }
  "line cook":    { revenuePerHr: 120, coversPerHr: 15, floor: 1, source: "NRA Industry Operations Report 2023", sourceUrl: "https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/" },
  "prep":         { revenuePerHr: 200, coversPerHr: 25, floor: 1, source: "NRA Industry Operations Report 2023", sourceUrl: "https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/" },
  "dishwasher":   { revenuePerHr: 250, coversPerHr: 30, floor: 1, source: "NRA Industry Operations Report 2023", sourceUrl: "https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/" },
  "server":       { revenuePerHr: 80,  coversPerHr: 12, floor: 1, source: "Cornell Hospitality Quarterly — Labor Productivity in Foodservice", sourceUrl: "https://journals.sagepub.com/home/cqx" },
  "foh":          { revenuePerHr: 80,  coversPerHr: 12, floor: 1, source: "Cornell Hospitality Quarterly — Labor Productivity in Foodservice", sourceUrl: "https://journals.sagepub.com/home/cqx" },
  "cashier":      { revenuePerHr: 150, coversPerHr: 20, floor: 1, source: "7shifts Restaurant Labor Benchmark Report 2023", sourceUrl: "https://www.7shifts.com/blog/restaurant-labor-cost/" },
  "counter":      { revenuePerHr: 150, coversPerHr: 20, floor: 1, source: "7shifts Restaurant Labor Benchmark Report 2023", sourceUrl: "https://www.7shifts.com/blog/restaurant-labor-cost/" },
  "delivery":     { revenuePerHr: 180, coversPerHr: 22, floor: 0, source: "7shifts Restaurant Labor Benchmark Report 2023", sourceUrl: "https://www.7shifts.com/blog/restaurant-labor-cost/" },
  "manager":      { revenuePerHr: null, coversPerHr: null, floor: 1, source: "Fixed floor — managerial coverage standard", sourceUrl: "https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/" },
  "default":      { revenuePerHr: 150, coversPerHr: 18, floor: 1, source: "NRA Industry Operations Report 2023 (general)", sourceUrl: "https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/" },
};

const DAY_TYPE_MULTIPLIERS = { Slow: 0.7, Normal: 1.0, Busy: 1.3, Event: 1.5 };

const BREAK_RULES = {
  // WA state: RCW 49.12.187
  paidRestPer4hrs: 10,   // minutes — always paid
  mealBreakAt5hrs: 30,   // minutes — paid or unpaid (user toggles)
};

function getBenchmark(roleName) {
  const lower = (roleName || "").toLowerCase();
  for (const [key, val] of Object.entries(FORECAST_BENCHMARKS)) {
    if (key !== "default" && lower.includes(key)) return { ...val };
  }
  return { ...FORECAST_BENCHMARKS.default };
}

function calcBreakMinutes(shiftHrs, mealPaid) {
  // Paid 10-min rests: 1 per 4-hr block
  const restBreaks = Math.floor(shiftHrs / 4) * BREAK_RULES.paidRestPer4hrs;
  // Meal break at 5+ hrs: paid only if toggle is on
  const mealBreak = shiftHrs >= 5 ? (mealPaid ? BREAK_RULES.mealBreakAt5hrs : 0) : 0;
  return restBreaks + mealBreak;
}

function calcOperatingHrs(openTime, closeTime) {
  if (!openTime || !closeTime) return 0;
  const [oh, om] = openTime.split(":").map(Number);
  const [ch, cm] = closeTime.split(":").map(Number);
  const mins = (ch * 60 + cm) - (oh * 60 + om);
  return Math.max(0, mins / 60);
}

function runRuleEngine(inputs, hourlyRoles, assumptions, mealBreakPaid) {
  // inputs: { days: { mon: { open, close, dayType, revenue, covers, directHrs, closed } } }
  // Returns: { roleId: { totalHrs, headcount, hoursPerDay: { mon: X } } }
  const results = {};

  hourlyRoles.forEach(role => {
    const bench = assumptions[role.id] || getBenchmark(role.name);
    let totalNeededHrs = 0;
    const hoursPerDay = {};

    DAYS.forEach(day => {
      const d = inputs.days[day] || {};
      if (d.closed) { hoursPerDay[day] = 0; return; }

      const opHrs = calcOperatingHrs(d.open, d.close);
      const multiplier = DAY_TYPE_MULTIPLIERS[d.dayType || "Normal"];

      let hrsFromRevenue = 0, hrsFromCovers = 0, hrsFromDirect = 0, hrsFromOp = 0;

      // Floor: minimum coverage = opHrs * floor indicator (1 person for full shift)
      const floorHrs = bench.floor > 0 ? opHrs : 0;

      // Volume-driven ceiling
      if (d.revenue && bench.revenuePerHr) {
        hrsFromRevenue = (Number(d.revenue) * multiplier) / bench.revenuePerHr;
      }
      if (d.covers && bench.coversPerHr) {
        hrsFromCovers = (Number(d.covers) * multiplier) / bench.coversPerHr;
      }
      if (d.directHrs) {
        hrsFromDirect = Number(d.directHrs);
      }

      // Take max of floor and all volume signals
      const volumeHrs = Math.max(hrsFromRevenue, hrsFromCovers, hrsFromDirect);
      const rawHrs = Math.max(floorHrs, volumeHrs);

      // Add break time if paid
      const breakMins = rawHrs > 0 ? calcBreakMinutes(rawHrs, mealBreakPaid) : 0;
      const totalHrs = rawHrs + breakMins / 60;

      hoursPerDay[day] = Math.round(totalHrs * 2) / 2; // round to 0.5
      totalNeededHrs += hoursPerDay[day];
    });

    // Headcount: how many people needed to cover totalNeededHrs at ~defaultHours each
    const defaultShift = role.defaultHours || 35;
    const headcount = Math.max(bench.floor, Math.ceil(totalNeededHrs / defaultShift));

    results[role.id] = { totalHrs: totalNeededHrs, headcount, hoursPerDay };
  });

  return results;
}

function distributeEvenly(totalHrs, operatingDays) {
  if (!operatingDays.length) return {};
  const perDay = Math.round((totalHrs / operatingDays.length) * 2) / 2;
  return Object.fromEntries(DAYS.map(d => [d, operatingDays.includes(d) ? perDay : 0]));
}

function distributeWeighted(totalHrs, inputs) {
  // Weekend days get 1.4× weight, Friday 1.2×, others 1.0×
  const weights = { mon: 1.0, tue: 1.0, wed: 1.0, thu: 1.0, fri: 1.2, sat: 1.4, sun: 1.4 };
  const operatingDays = DAYS.filter(d => !(inputs.days[d]?.closed));
  const totalWeight = operatingDays.reduce((s, d) => s + (weights[d] || 1.0), 0);
  return Object.fromEntries(DAYS.map(d => {
    if (inputs.days[d]?.closed || !operatingDays.includes(d)) return [d, 0];
    return [d, Math.round((totalHrs * (weights[d] / totalWeight)) * 2) / 2];
  }));
}

// Info tooltip component
function InfoTip({ url, source }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 4 }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ cursor: "pointer", fontSize: 11, color: CN.blue, fontWeight: 700,
          width: 16, height: 16, borderRadius: "50%", border: `1px solid ${CN.blue}`,
          display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        i
      </span>
      {show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          backgroundColor: CN.dark, color: CN.white, borderRadius: 8, padding: "8px 12px",
          fontSize: 11, whiteSpace: "nowrap", zIndex: 500, maxWidth: 280, whiteSpace: "normal",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Source</div>
          <div style={{ opacity: 0.85, marginBottom: 6 }}>{source}</div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ color: "#7DD3C8", fontSize: 10, wordBreak: "break-all" }}>{url}</a>
        </div>
      )}
    </span>
  );
}

function ForecasterTab({ roleScenarios, setRoleScenarios, planScenarios, setPlanScenarios,
                         taxYears, ot, isMobile, onAccepted }) {

  const currentYear = new Date().getFullYear();
  const tax = taxYears?.[currentYear] || DEFAULT_TAX;

  // All active hourly roles from active role scenario
  const activeRS = roleScenarios?.scenarios?.find(s => s.id === roleScenarios.activeId);
  const [localRoles, setLocalRoles] = useState(() =>
    (activeRS?.roles || []).filter(r => r.active && r.payType === "Hourly")
  );

  // Week
  const [weekOf, setWeekOf] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoMonday(d);
  });

  // Day inputs
  const defaultDayInputs = () => DAYS.reduce((a, d) => ({
    ...a,
    [d]: { open: "11:00", close: "21:00", dayType: "Normal", revenue: "", covers: "", directHrs: "", closed: d === "mon" }
  }), {});
  const [dayInputs, setDayInputs] = useState(defaultDayInputs);
  const setDay = (day, field, val) => setDayInputs(p => ({ ...p, [day]: { ...p[day], [field]: val } }));

  // Input mode
  const [inputMode, setInputMode] = useState("revenue"); // revenue | covers | direct | oponly

  // Break toggle
  const [mealBreakPaid, setMealBreakPaid] = useState(true);

  // Per-role assumptions (editable)
  const [assumptions, setAssumptions] = useState(() =>
    Object.fromEntries(localRoles.map(r => [r.id, getBenchmark(r.name)]))
  );
  const setAssumption = (roleId, field, val) =>
    setAssumptions(p => ({ ...p, [roleId]: { ...p[roleId], [field]: isNaN(Number(val)) ? val : Number(val) } }));

  // Results
  const [results, setResults] = useState(null);
  const [claudeNarrative, setClaudeNarrative] = useState("");
  const [claudeDistribution, setClaudeDistribution] = useState(null); // { roleId: hoursPerDay }
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  // Display mode for distribution
  const [distMode, setDistMode] = useState("claude"); // claude | even | weighted

  // Output format
  const [outputFormat, setOutputFormat] = useState("skeleton"); // headcount | hours | skeleton

  // Gap detection — roles suggested by name not in localRoles
  const [gaps, setGaps] = useState([]); // [{ suggestedName, category }]
  const [newRoleForms, setNewRoleForms] = useState({}); // gapName → partial role data

  // Inline role addition
  const [addingGap, setAddingGap] = useState(null);
  const [gapForm, setGapForm] = useState({ name: "", category: "BOH", rate: "", defaultHours: 35, otEligible: true, isMinor: false });

  // Accept state
  const [accepted, setAccepted] = useState(false);
  const [acceptedScenarios, setAcceptedScenarios] = useState(null);

  // Sync localRoles when roleScenarios changes
  useEffect(() => {
    const rs = roleScenarios?.scenarios?.find(s => s.id === roleScenarios.activeId);
    const hourly = (rs?.roles || []).filter(r => r.active && r.payType === "Hourly");
    setLocalRoles(hourly);
    setAssumptions(Object.fromEntries(hourly.map(r => [r.id, getBenchmark(r.name)])));
  }, [roleScenarios]);

  const operatingDays = DAYS.filter(d => !dayInputs[d]?.closed);

  // ── Run forecast ──────────────────────────────────────────────────
  async function runForecast() {
    setRunning(true); setRunError(""); setClaudeNarrative(""); setClaudeDistribution(null); setResults(null); setGaps([]);
    try {
      const ruleResults = runRuleEngine(
        { days: dayInputs },
        localRoles,
        assumptions,
        mealBreakPaid
      );
      setResults(ruleResults);

      // Build Claude prompt
      const weekSummary = DAYS.map(d => {
        const di = dayInputs[d];
        if (di.closed) return `${DAY_LABELS[DAYS.indexOf(d)]}: Closed`;
        const opHrs = calcOperatingHrs(di.open, di.close).toFixed(1);
        const parts = [`${di.open}–${di.close} (${opHrs}h)`, `${di.dayType}`];
        if (di.revenue) parts.push(`$${di.revenue} rev`);
        if (di.covers) parts.push(`${di.covers} covers`);
        return `${DAY_LABELS[DAYS.indexOf(d)]}: ${parts.join(", ")}`;
      }).join("\n");

      const roleSummary = localRoles.map(r => {
        const b = assumptions[r.id];
        const res = ruleResults[r.id];
        return `- ${r.name} (${r.category}): ${res?.totalHrs.toFixed(1)}h needed, ${res?.headcount} people, rate $${r.rate}/hr. Benchmarks: $${b.revenuePerHr}/rev-hr, ${b.coversPerHr} covers/hr, floor ${b.floor}.`;
      }).join("\n");

      const prompt = `You are a restaurant operations analyst. Analyze this staffing plan for Cheeky Noodles and provide:
1. A brief narrative (3–5 sentences) explaining the staffing recommendation and any notable observations.
2. A JSON block (fenced with \`\`\`json) with day-by-day hour distribution per role ID. Keys are role IDs, values are objects with day keys (mon/tue/wed/thu/fri/sat/sun) and hour values (number, rounded to 0.5).

Week: ${fmtWeek(weekOf)}
Operating schedule:
${weekSummary}

Hourly roles and rule-engine output:
${roleSummary}

Meal breaks: ${mealBreakPaid ? "paid (included in hours)" : "unpaid (not in hours)"}
Input mode: ${inputMode}

Distribute hours thoughtfully across operating days, weighting heavier days appropriately. Keep total hours per role close to the rule-engine totals. Return ONLY the narrative then the JSON block.`;

      const response = await fetch("https://cheeky-headcount-proxy.vaughan-184.workers.dev/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";

      // Extract JSON block
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
      let dist = null;
      if (jsonMatch) {
        try { dist = JSON.parse(jsonMatch[1]); } catch {}
      }

      // Narrative = everything before the json block
      const narrative = text.replace(/```json[\s\S]*?```/, "").trim();
      setClaudeNarrative(narrative);
      if (dist) setClaudeDistribution(dist);

      // Gap detection — Claude may mention roles in narrative; also check if rule results suggest
      // more headcount than localRoles can provide
      const detectedGaps = [];
      localRoles.forEach(r => {
        const res = ruleResults[r.id];
        if (res && res.headcount > localRoles.filter(x => x.name === r.name).length * 3) {
          // Heuristic: if headcount > 3× occurrences, suggest adding a variant
        }
      });
      setGaps(detectedGaps);

    } catch (e) {
      setRunError("Forecast failed: " + e.message);
    } finally {
      setRunning(false);
    }
  }

  // ── Distribution helpers ──────────────────────────────────────────
  function getDistribution(roleId) {
    if (distMode === "claude" && claudeDistribution?.[roleId]) return claudeDistribution[roleId];
    const totalHrs = results?.[roleId]?.totalHrs || 0;
    if (distMode === "even") return distributeEvenly(totalHrs, operatingDays);
    return distributeWeighted(totalHrs, { days: dayInputs });
  }

  // ── Cost calculation for results ─────────────────────────────────
  function calcForecastCost(roleId) {
    const role = localRoles.find(r => r.id === roleId);
    if (!role || !results?.[roleId]) return null;
    const dist = getDistribution(roleId);
    return calcRowCost(role, dist, tax, ot);
  }

  const totalCost = results
    ? localRoles.reduce((s, r) => { const c = calcForecastCost(r.id); return s + (c?.total || 0); }, 0)
    : 0;

  // ── Add gap role inline ───────────────────────────────────────────
  function commitGapRole() {
    if (!gapForm.name || !gapForm.rate) return;
    const newRole = {
      id: uid(), name: gapForm.name, category: gapForm.category,
      payType: "Hourly", rate: Number(gapForm.rate), defaultHours: Number(gapForm.defaultHours) || 35,
      otEligible: gapForm.otEligible, exempt: false, isMinor: gapForm.isMinor,
      benefits: { ...DEFAULT_BENEFITS }, active: true
    };
    // Add to active role scenario
    setRoleScenarios(prev => ({
      ...prev,
      scenarios: prev.scenarios.map(s =>
        s.id === prev.activeId ? { ...s, roles: [...s.roles, newRole] } : s
      )
    }));
    setLocalRoles(p => [...p, newRole]);
    setAssumptions(p => ({ ...p, [newRole.id]: getBenchmark(newRole.name) }));
    setGaps(p => p.filter(g => g !== addingGap));
    setAddingGap(null);
    setGapForm({ name: "", category: "BOH", rate: "", defaultHours: 35, otEligible: true, isMinor: false });
  }

  // ── Accept forecast → create scenarios ───────────────────────────
  function acceptForecast() {
    if (!results) return;
    const label = `Forecast — ${fmtWeek(weekOf)}`;

    // Build role scenario from localRoles (includes any gap roles added)
    const newRS = makeRoleScenario(label, localRoles);
    const updatedRS = {
      ...roleScenarios,
      scenarios: [...roleScenarios.scenarios, newRS]
    };

    // Build plan scenario with forecast hours
    const newPS = makePlanScenario(label, newRS.id);
    const plans = [];
    localRoles.forEach(role => {
      const dist = getDistribution(role.id);
      const headcount = results[role.id]?.headcount || 1;
      // Create one plan row per person (headcount), distribute hours across them
      for (let i = 0; i < headcount; i++) {
        const days = {};
        DAYS.forEach(d => {
          const dayTotal = dist[d] || 0;
          // Split hours evenly across headcount rows
          days[d] = Math.round((dayTotal / headcount) * 2) / 2;
        });
        plans.push({ id: uid(), weekOf, roleId: role.id, days });
      }
    });
    newPS.plans = plans;

    const updatedPS = {
      ...planScenarios,
      scenarios: [...planScenarios.scenarios, newPS],
      activeId: newPS.id
    };

    setRoleScenarios(updatedRS);
    setPlanScenarios(updatedPS);
    setAccepted(true);
    setAcceptedScenarios({ roleName: newRS.name, planName: newPS.name });
    if (onAccepted) onAccepted();
  }

  // ── Render ────────────────────────────────────────────────────────
  const stepStyle = { marginBottom: 24 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.07em", color: CN.mid, marginBottom: 8, display: "block" };
  const inputStyle = { border: `1.5px solid ${CN.border}`, borderRadius: 8, padding: "7px 10px",
    fontSize: 13, fontFamily: "'DM Sans',sans-serif", color: CN.dark, backgroundColor: CN.white,
    outline: "none", width: "100%", boxSizing: "border-box" };
  const pillBtn = (active, onClick, label) => (
    <button onClick={onClick} style={{
      padding: "5px 13px", borderRadius: 99, border: `1.5px solid ${active ? CN.orange : CN.border}`,
      backgroundColor: active ? CN.orangeLight : CN.white, color: active ? CN.orange : CN.mid,
      fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: active ? 700 : 400, cursor: "pointer"
    }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: isMobile ? "16px 12px" : "28px 24px" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: isMobile ? 20 : 26,
          textTransform: "uppercase", color: CN.dark, letterSpacing: "0.06em" }}>
          🔮 Headcount Forecaster
        </div>
        <div style={{ fontSize: 13, color: CN.mid, marginTop: 4 }}>
          Build a staffing plan from your operating schedule. Rule-based engine + Claude analysis.
        </div>
      </div>

      {accepted && acceptedScenarios && (
        <Note type="success">
          ✅ Forecast accepted. Created role scenario <strong>"{acceptedScenarios.roleName}"</strong> and
          schedule scenario <strong>"{acceptedScenarios.planName}"</strong>. Switch to the Schedule tab to review and edit.
        </Note>
      )}

      {/* ── Step 1: Week + breaks ── */}
      <Card style={stepStyle}>
        <Sub>Step 1 — Week Setup</Sub>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
          <div style={{ flex: "1 1 180px" }}>
            <span style={sectionLabel}>Week of</span>
            <input type="date" value={weekOf}
              onChange={e => setWeekOf(e.target.value)}
              style={{ ...inputStyle, width: "auto" }} />
          </div>
          <div style={{ flex: "1 1 220px" }}>
            <span style={sectionLabel}>Meal break treatment</span>
            <div style={{ display: "flex", gap: 8 }}>
              {pillBtn(mealBreakPaid, () => setMealBreakPaid(true), "Paid (include in hours)")}
              {pillBtn(!mealBreakPaid, () => setMealBreakPaid(false), "Unpaid (exclude)")}
            </div>
            <div style={{ fontSize: 11, color: CN.mid, marginTop: 4 }}>
              10-min paid rests (per 4h) always included · WA RCW 49.12.187
            </div>
          </div>
        </div>

        {/* Day grid */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 560 }}>
            <thead>
              <tr style={{ backgroundColor: CN.creamDark }}>
                <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Day</th>
                <th style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Closed</th>
                <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Open</th>
                <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Close</th>
                <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Day Type</th>
                <th style={{ padding: "7px 6px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Op Hrs</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d, i) => {
                const di = dayInputs[d];
                const opHrs = di.closed ? 0 : calcOperatingHrs(di.open, di.close);
                return (
                  <tr key={d} style={{ backgroundColor: i % 2 === 0 ? CN.white : CN.cream, opacity: di.closed ? 0.45 : 1 }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600, color: CN.dark }}>{DAY_LABELS[i]}</td>
                    <td style={{ padding: "7px 10px", textAlign: "center" }}>
                      <input type="checkbox" checked={!!di.closed} onChange={e => setDay(d, "closed", e.target.checked)}
                        style={{ accentColor: CN.orange, width: 15, height: 15 }} />
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      <input type="time" value={di.open} disabled={di.closed}
                        onChange={e => setDay(d, "open", e.target.value)}
                        style={{ ...inputStyle, width: 100, opacity: di.closed ? 0.4 : 1 }} />
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      <input type="time" value={di.close} disabled={di.closed}
                        onChange={e => setDay(d, "close", e.target.value)}
                        style={{ ...inputStyle, width: 100, opacity: di.closed ? 0.4 : 1 }} />
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      <select value={di.dayType} disabled={di.closed}
                        onChange={e => setDay(d, "dayType", e.target.value)}
                        style={{ ...inputStyle, width: 100, opacity: di.closed ? 0.4 : 1 }}>
                        {Object.keys(DAY_TYPE_MULTIPLIERS).map(t => (
                          <option key={t} value={t}>{t} ({DAY_TYPE_MULTIPLIERS[t]}×)</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "7px 6px", fontWeight: 700, color: opHrs > 0 ? CN.dark : CN.mid, fontSize: 13 }}>
                      {opHrs > 0 ? opHrs.toFixed(1) + "h" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Step 2: Input mode + volume data ── */}
      <Card style={stepStyle}>
        <Sub>Step 2 — Volume Inputs</Sub>
        <div style={{ marginBottom: 12 }}>
          <span style={sectionLabel}>Forecasting basis</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              ["revenue", "💰 Revenue target"],
              ["covers",  "👥 Cover / transaction count"],
              ["direct",  "⏱ Direct labor hours"],
              ["oponly",  "🕐 Operating hours only (floor)"],
            ].map(([mode, label]) => pillBtn(inputMode === mode, () => setInputMode(mode), label))}
          </div>
          {inputMode === "oponly" && (
            <div style={{ fontSize: 12, color: CN.mid, marginTop: 8 }}>
              Floor-only mode: staffing is based purely on hours of operation and role minimum coverage. No volume signals used.
            </div>
          )}
        </div>

        {inputMode !== "oponly" && (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 480 }}>
              <thead>
                <tr style={{ backgroundColor: CN.creamDark }}>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Day</th>
                  {inputMode === "revenue" && <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Revenue ($)</th>}
                  {inputMode === "covers"  && <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Covers</th>}
                  {inputMode === "direct"  && <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Labor Hours</th>}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d, i) => {
                  const di = dayInputs[d];
                  if (di.closed) return null;
                  return (
                    <tr key={d} style={{ backgroundColor: i % 2 === 0 ? CN.white : CN.cream }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: CN.dark }}>{DAY_LABELS[i]}</td>
                      <td style={{ padding: "4px 8px" }}>
                        {inputMode === "revenue" && (
                          <input type="number" min={0} value={di.revenue} placeholder="e.g. 2500"
                            onChange={e => setDay(d, "revenue", e.target.value)}
                            style={{ ...inputStyle, width: 130 }} />
                        )}
                        {inputMode === "covers" && (
                          <input type="number" min={0} value={di.covers} placeholder="e.g. 80"
                            onChange={e => setDay(d, "covers", e.target.value)}
                            style={{ ...inputStyle, width: 130 }} />
                        )}
                        {inputMode === "direct" && (
                          <input type="number" min={0} step={0.5} value={di.directHrs} placeholder="e.g. 40"
                            onChange={e => setDay(d, "directHrs", e.target.value)}
                            style={{ ...inputStyle, width: 130 }} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Step 3: Assumptions per role ── */}
      <Card style={stepStyle}>
        <Sub>Step 3 — Productivity Assumptions</Sub>
        <Note type="info">
          These are planning benchmarks — not actuals. Edit to match your operation before running. Sources linked via (i).
        </Note>
        {localRoles.length === 0 && (
          <Note type="warning">No active hourly roles found. Add roles in the Job Roles tab first.</Note>
        )}
        {localRoles.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 580 }}>
              <thead>
                <tr style={{ backgroundColor: CN.creamDark }}>
                  <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, color: CN.mid, fontSize: 11 }}>Role</th>
                  <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>
                    Rev/hr ($) <InfoTip source={getBenchmark("default").source} url={getBenchmark("default").sourceUrl} />
                  </th>
                  <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>
                    Covers/hr <InfoTip source="Cornell Hospitality Quarterly — Labor Productivity in Foodservice" url="https://journals.sagepub.com/home/cqx" />
                  </th>
                  <th style={{ padding: "7px 10px", fontWeight: 700, color: CN.mid, fontSize: 11 }}>
                    Floor <InfoTip source="Minimum viable coverage — 1 person must be present for the role whenever open" url="https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {localRoles.map((r, i) => {
                  const a = assumptions[r.id] || getBenchmark(r.name);
                  const bench = getBenchmark(r.name);
                  return (
                    <tr key={r.id} style={{ backgroundColor: i % 2 === 0 ? CN.white : CN.cream }}>
                      <td style={{ padding: "7px 10px" }}>
                        <div style={{ fontWeight: 600, color: CN.dark }}>{r.name}</div>
                        <div style={{ fontSize: 10, color: CN.mid }}>{r.category} · ${r.rate}/hr</div>
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="number" min={0} value={a.revenuePerHr ?? ""} placeholder="n/a"
                            onChange={e => setAssumption(r.id, "revenuePerHr", e.target.value === "" ? null : e.target.value)}
                            style={{ ...inputStyle, width: 80 }} />
                          <InfoTip source={bench.source} url={bench.sourceUrl} />
                        </div>
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="number" min={0} value={a.coversPerHr ?? ""} placeholder="n/a"
                            onChange={e => setAssumption(r.id, "coversPerHr", e.target.value === "" ? null : e.target.value)}
                            style={{ ...inputStyle, width: 80 }} />
                          <InfoTip source={bench.source} url={bench.sourceUrl} />
                        </div>
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <input type="number" min={0} max={5} value={a.floor}
                          onChange={e => setAssumption(r.id, "floor", e.target.value)}
                          style={{ ...inputStyle, width: 60 }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Gap role addition */}
        {gaps.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: CN.amberDark, marginBottom: 8 }}>⚠ Suggested roles not yet configured:</div>
            {gaps.map(gap => (
              <div key={gap} style={{ marginBottom: 8 }}>
                {addingGap === gap ? (
                  <div style={{ backgroundColor: CN.creamDark, borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Add role: {gap}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <input placeholder="Role name" value={gapForm.name}
                        onChange={e => setGapForm(p => ({ ...p, name: e.target.value }))}
                        style={{ ...inputStyle, width: 160 }} />
                      <select value={gapForm.category}
                        onChange={e => setGapForm(p => ({ ...p, category: e.target.value }))}
                        style={{ ...inputStyle, width: 120 }}>
                        {["BOH","FOH","Management","Other"].map(c => <option key={c}>{c}</option>)}
                      </select>
                      <input type="number" placeholder="$/hr" value={gapForm.rate}
                        onChange={e => setGapForm(p => ({ ...p, rate: e.target.value }))}
                        style={{ ...inputStyle, width: 90 }} />
                      <input type="number" placeholder="Default hrs/wk" value={gapForm.defaultHours}
                        onChange={e => setGapForm(p => ({ ...p, defaultHours: e.target.value }))}
                        style={{ ...inputStyle, width: 130 }} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn onClick={commitGapRole} style={{ opacity: gapForm.name && gapForm.rate ? 1 : 0.4 }}>Add Role</Btn>
                      <Btn variant="ghost" onClick={() => setAddingGap(null)}>Cancel</Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    backgroundColor: CN.amberLight, borderRadius: 8, border: `1px solid ${CN.amber}` }}>
                    <span style={{ fontSize: 12, color: CN.amberDark, flex: 1 }}>Missing role: <strong>{gap}</strong></span>
                    <Btn variant="ghost" onClick={() => { setAddingGap(gap); setGapForm(p => ({ ...p, name: gap })); }}>
                      Add Inline
                    </Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button onClick={runForecast} disabled={running || localRoles.length === 0}
            style={{ padding: "10px 24px", backgroundColor: running ? CN.mid : CN.orange, color: CN.white,
              border: "none", borderRadius: 10, cursor: running ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif",
              textTransform: "uppercase", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 8 }}>
            {running ? "⟳ Running…" : "▶ Run Forecast"}
          </button>
          {runError && <div style={{ color: CN.red, fontSize: 12, marginTop: 8 }}>{runError}</div>}
        </div>
      </Card>

      {/* ── Results ── */}
      {results && (
        <>
          {/* Claude narrative */}
          {claudeNarrative && (
            <Card style={stepStyle}>
              <Sub>Claude Analysis</Sub>
              <div style={{ fontSize: 13, color: CN.dark, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                {claudeNarrative}
              </div>
            </Card>
          )}

          {/* Distribution toggle */}
          <Card style={stepStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <Sub style={{ margin: 0 }}>Step 4 — Forecast Results</Sub>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: CN.mid, alignSelf: "center" }}>Distribution:</span>
                {(claudeDistribution ? [["claude","🤖 Claude"],["even","⚖ Even"],["weighted","📅 Day-weighted"]] : [["even","⚖ Even"],["weighted","📅 Day-weighted"]]).map(([m,l]) =>
                  pillBtn(distMode === m, () => setDistMode(m), l)
                )}
              </div>
            </div>

            {localRoles.map((role, ri) => {
              const res = results[role.id];
              if (!res) return null;
              const dist = getDistribution(role.id);
              const cost = calcForecastCost(role.id);
              return (
                <div key={role.id} style={{ marginBottom: 16, border: `1.5px solid ${CN.border}`,
                  borderRadius: 10, overflow: "hidden" }}>
                  {/* Role header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", backgroundColor: CN.creamDark, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: CN.dark }}>{role.name}</span>
                      <span style={{ fontSize: 11, color: CN.mid, marginLeft: 8 }}>{role.category} · ${role.rate}/hr</span>
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: CN.mid }}>People needed</div>
                        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 800, color: CN.orange }}>
                          {res.headcount}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: CN.mid }}>Total hrs</div>
                        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 800, color: CN.dark }}>
                          {res.totalHrs.toFixed(1)}h
                        </div>
                      </div>
                      {cost && (
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 10, color: CN.mid }}>Week cost</div>
                          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 800, color: CN.blue }}>
                            {fmt$(cost.total)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Day breakdown */}
                  <div style={{ display: "flex", borderTop: `1px solid ${CN.border}` }}>
                    {DAYS.map((d, i) => {
                      const hrs = dist[d] || 0;
                      const closed = dayInputs[d]?.closed;
                      return (
                        <div key={d} style={{ flex: 1, padding: "8px 4px", textAlign: "center",
                          backgroundColor: closed ? CN.creamDark : hrs > 0 ? CN.white : CN.cream,
                          borderRight: i < 6 ? `1px solid ${CN.border}` : "none" }}>
                          <div style={{ fontSize: 10, color: CN.mid, fontWeight: 600 }}>{DAY_LABELS[i]}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: closed ? CN.border : hrs > 0 ? CN.dark : CN.mid, marginTop: 2 }}>
                            {closed ? "—" : hrs > 0 ? hrs + "h" : "0h"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Cost breakdown */}
                  {cost && (
                    <div style={{ display: "flex", gap: 16, padding: "8px 14px", backgroundColor: CN.cream,
                      fontSize: 11, color: CN.mid, flexWrap: "wrap" }}>
                      <span>Wages: <strong>{fmt$(cost.wages)}</strong></span>
                      <span>Taxes: <strong>{fmt$(cost.taxes)}</strong></span>
                      <span>Benefits: <strong>{fmt$(cost.benefits)}</strong></span>
                      {cost.otHrs > 0 && <span style={{ color: CN.amberDark }}>OT: {cost.otHrs.toFixed(1)}h</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Total cost */}
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 14px",
              backgroundColor: CN.dark, borderRadius: 10, marginTop: 8 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Total forecast labor cost</div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 800, color: CN.white }}>
                  {fmt$(totalCost)}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Step 5: Accept ── */}
          <Card>
            <Sub>Step 5 — Accept Forecast</Sub>
            <div style={{ marginBottom: 14 }}>
              <span style={sectionLabel}>Output format</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {pillBtn(outputFormat === "headcount", () => setOutputFormat("headcount"), "👤 Headcount summary")}
                {pillBtn(outputFormat === "hours",     () => setOutputFormat("hours"),     "⏱ Hours per role")}
                {pillBtn(outputFormat === "skeleton",  () => setOutputFormat("skeleton"),  "📅 Weekly skeleton")}
              </div>
              <div style={{ fontSize: 11, color: CN.mid, marginTop: 6 }}>
                {outputFormat === "headcount" && "Creates a role scenario with the suggested number of people. No hours pre-filled."}
                {outputFormat === "hours"     && "Creates a plan scenario with total weekly hours per role, distributed evenly."}
                {outputFormat === "skeleton"  && "Creates a full day-by-day schedule using the " + distMode + " distribution."}
              </div>
            </div>

            <Note type="info">
              This will create a new Role Scenario and Schedule Scenario labelled "Forecast — {fmtWeek(weekOf)}". You can rename them after.
            </Note>

            <Btn onClick={acceptForecast} style={{ marginTop: 4 }}>
              ✓ Accept &amp; Create Scenarios
            </Btn>
          </Card>
        </>
      )}
    </div>
  );
}

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
  const [actingAsUser, setActingAsUser] = useState(false);
  const effectiveAdmin = isAdmin && !actingAsUser;
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
    // Normalize: if no scenario is marked isDefault, stamp the first one.
    // This handles data saved before the isDefault feature was introduced.
    if (rs && rs.scenarios.length > 0 && !rs.scenarios.some(s => s.isDefault)) {
      rs = { ...rs, scenarios: rs.scenarios.map((s, i) => i === 0 ? { ...s, isDefault: true } : s) };
    }
    setRoleScenarios(rs); setSavedRS(deepClone(rs)); lastKnownAt.current[SK.roleScenarios] = rsData.updated_at;

    let ps = psData.value;
    if (!ps) { ps = (await getMigrated()).ps; }
    // Same normalization for plan scenarios
    if (ps && ps.scenarios.length > 0 && !ps.scenarios.some(s => s.isDefault)) {
      ps = { ...ps, scenarios: ps.scenarios.map((s, i) => i === 0 ? { ...s, isDefault: true } : s) };
    }
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
    { id: "roles",      label: "Job Roles",    icon: tabIcons.roles,   dirty: rolesDirty },
    { id: "plan",       label: "Schedule",     icon: tabIcons.plan,    dirty: plansDirty },
    { id: "forecast",   label: "Forecaster",   icon: "🔮",             dirty: false },
    { id: "summary",    label: "Summary",      icon: tabIcons.summary, dirty: false },
    { id: "settings",   label: "Taxes & Regs", icon: "⚖️",             dirty: settingsDirty },
    ...(effectiveAdmin ? [{ id: "admin", label: "Admin", icon: "🔐", dirty: false }] : []),
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
      <div style={{background:`linear-gradient(135deg,${CN.orange} 0%,#D93200 100%)`,padding:isMobile?"10px 14px":"14px 24px",boxShadow:"0 2px 12px rgba(244,58,10,0.25)"}}>
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

            {/* Admin / User view toggle — only shown to real admins */}
            {isAdmin&&(
              <button onClick={()=>{setActingAsUser(v=>!v);if(tab==="admin")setTab("plan");}}
                title={effectiveAdmin?"Switch to User view":"Switch to Admin view"}
                style={{background:effectiveAdmin?"rgba(124,58,237,0.25)":"rgba(255,255,255,0.15)",border:`1px solid ${effectiveAdmin?"rgba(167,139,250,0.6)":"rgba(255,255,255,0.3)"}`,borderRadius:8,padding:"6px 12px",color:CN.white,cursor:"pointer",fontSize:"12px",fontWeight:700,fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
                {effectiveAdmin?"🔐 Admin":"👤 User"}
              </button>
            )}

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
          taxYears={taxYears} ot={ot} isAdmin={effectiveAdmin}
          dirty={rolesDirty} onSave={saveRoles} onClear={clearRoles} saving={saving.roles} isMobile={isMobile}
        />}
        {tab==="plan"&&planScenarios&&roleScenarios&&<PlanTab
          roleScenarios={roleScenarios} planScenarios={planScenarios} setPlanScenarios={setPlanScenarios}
          taxYears={taxYears} ot={ot} isAdmin={effectiveAdmin}
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
        {tab==="forecast"&&roleScenarios&&planScenarios&&<ForecasterTab
          roleScenarios={roleScenarios} setRoleScenarios={setRoleScenarios}
          planScenarios={planScenarios} setPlanScenarios={setPlanScenarios}
          taxYears={taxYears} ot={ot} isMobile={isMobile}
          onAccepted={()=>{ saveRoles(); savePlans(); }}
        />}
        {tab==="admin"&&effectiveAdmin&&<AdminTab
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