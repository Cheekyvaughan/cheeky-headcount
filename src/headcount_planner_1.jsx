import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

// ── Mobile detection ──────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
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

// ── Brand palette ─────────────────────────────────────────────────
const CN = {
  orange: "#FF3C00", orangeHover: "#D93200", orangeLight: "#FFEDE8",
  cream: "#FBF5DF", creamDark: "#EFE7C8",
  dark: "#3C3C37", mid: "#494843",
  border: "#EAE6E5", white: "#FFFFFF",
  amber: "#F0B030", amberLight: "#FFF5CC", amberDark: "#C88800",
  red: "#CC2800", redLight: "#FFE0D8",
  blue: "#09A387", blueLight: "#D0EFE8",
  green: "#078A72", greenLight: "#D0EFE8",
  purple: "#494843", purpleLight: "#E8E6DF",
  // Sidebar-specific
  sidebarBg: "#242420",
  sidebarHover: "rgba(255,255,255,0.05)",
  sidebarActive: "rgba(255,59,0,0.14)",
  sidebarText: "rgba(255,255,255,0.65)",
  sidebarLabel: "rgba(255,255,255,0.28)",
};

// ── Tax / OT defaults ─────────────────────────────────────────────
function defaultTaxForYear(year) {
  return {
    federalSS: 6.2, federalMedicare: 1.45, futa: 0.6,
    waSUI: 1.2, waLnI: 1.85, waPFML: 0,
    ssWageBase: 176100, suiWageBase: 72800,
    minWage: 16.66, minWageMinor: 0, nonExemptWeeklyMin: 1332.80,
    effectiveDate: `Jan 1, ${year}`, finalized: false,
  };
}
const DEFAULT_TAX = defaultTaxForYear(new Date().getFullYear());
const DEFAULT_OT = { weeklyThreshold: 40, dailyMax: 10, multiplier: 1.5, nonExemptWeeklyMin: 1332.80 };
const DEFAULT_TAB_ICONS = { roles: "👥", plan: "📋", summary: "📊" };
const DEFAULT_BENEFITS = { healthMonthly: 0, dentalMonthly: 0, visionMonthly: 0, retirement401k: 0, otherMonthly: 0 };

const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const CATEGORIES = ["BOH","FOH","Management","Other"];
const PAY_TYPES = ["Hourly","Salary"];
const MAX_SCENARIOS = 10;

function userSK(userId) {
  return {
    roleScenarios: `cn-hc-role-scenarios-v1-${userId}`,
    planScenarios: `cn-hc-plan-scenarios-v1-${userId}`,
    sharedRoleScenarios: "cn-hc-role-scenarios-v1",
    sharedPlanScenarios: "cn-hc-plan-scenarios-v1",
    legacyRoles: "cn-hc-roles-v4",
    legacyPlans: "cn-hc-plans-v4",
  };
}
const SHARED_SK = {
  taxYears: "cn-hc-tax-years-v1",
  tax: "cn-hc-tax-v3",
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

function makeRoleScenario(name, roles, isDefault=false) {
  return { id:uid(), name, roles:deepClone(roles), isDefault };
}
function makePlanScenario(name, roleScenarioId, isDefault=false) {
  return { id:uid(), name, roleScenarioId, plans:[], isDefault };
}

// ── Cost calculation ──────────────────────────────────────────────
function calcRowCost(role, dayHours, tax, ot) {
  const T=tax||DEFAULT_TAX, O=ot||DEFAULT_OT;
  const totalHrs=DAYS.reduce((s,d)=>s+(parseFloat(dayHours[d])||0),0);
  let wages=0, otPremium=0, otHrs=0;
  if(role.payType==="Hourly"){
    const effectiveRate=(role.isMinor&&T.minWageMinor>0)?Math.max(role.rate,T.minWageMinor):role.rate;
    const reg=Math.min(totalHrs,O.weeklyThreshold);
    otHrs=role.otEligible?Math.max(0,totalHrs-O.weeklyThreshold):0;
    wages=reg*effectiveRate+otHrs*effectiveRate*O.multiplier;
    otPremium=otHrs*effectiveRate*(O.multiplier-1);
  } else {
    const weeklyRate=role.rate/4.33;
    if(role.exempt){wages=weeklyRate;}
    else{const dh=weeklyRate/O.weeklyThreshold;otHrs=Math.max(0,totalHrs-O.weeklyThreshold);otPremium=dh*(O.multiplier-1)*otHrs;wages=weeklyRate+otPremium;}
  }
  const tb={ss:wages*(T.federalSS/100),medicare:wages*(T.federalMedicare/100),futa:wages*(T.futa/100),sui:wages*(T.waSUI/100),lni:totalHrs*(T.waLnI||0),pfml:wages*(T.waPFML/100)};
  const taxes=Object.values(tb).reduce((s,v)=>s+v,0);
  const b=role.benefits||DEFAULT_BENEFITS;
  const monthly=(b.healthMonthly||0)+(b.dentalMonthly||0)+(b.visionMonthly||0)+(b.otherMonthly||0);
  const benefits=monthly/4.33+wages*(b.retirement401k||0)/100;
  return{wages,otPremium,taxes,benefits,total:wages+taxes+benefits,otHrs,totalHrs,taxBreakdown:tb};
}

const MINOR_WEEKLY_MAX=40;

function rowStatus(role,dayHours,ot){
  const O=ot||DEFAULT_OT;
  const totalHrs=DAYS.reduce((s,d)=>s+(parseFloat(dayHours[d])||0),0);
  const maxDay=Math.max(...DAYS.map(d=>parseFloat(dayHours[d])||0));
  if(role.isMinor&&totalHrs>MINOR_WEEKLY_MAX)return"minormax";
  if(O.dailyMax>0&&maxDay>O.dailyMax)return"daymax";
  const otApplies=role.payType==="Hourly"?role.otEligible:!role.exempt;
  if(otApplies&&totalHrs>O.weeklyThreshold)return"ot";
  if(otApplies&&totalHrs>=O.weeklyThreshold*0.85)return"nearot";
  return"ok";
}

const STATUS={
  ok:{rowBg:"transparent",icon:null},
  nearot:{rowBg:"#FFFDF0",icon:"🔶"},
  ot:{rowBg:"#FFF5CC",icon:"⚠️"},
  daymax:{rowBg:"#FFE0D8",icon:"🚨",label:"Potential Max Time"},
  minormax:{rowBg:"#FFE0D8",icon:"🔞"},
};

// ── Storage helpers ───────────────────────────────────────────────
async function loadS(key,fallback){try{const r=await window.storage.get(key);return r?JSON.parse(r.value):fallback;}catch{return fallback;}}
async function loadSWithTs(key,fallback){try{const r=await window.storage.get(key);return r?{value:JSON.parse(r.value),updated_at:r.updated_at||null}:{value:fallback,updated_at:null};}catch{return{value:fallback,updated_at:null};}}
async function saveS(key,val){try{await window.storage.set(key,JSON.stringify(val));}catch{}}

// ── Primitives ────────────────────────────────────────────────────
const CAT_STYLE={
  BOH:{bg:CN.orangeLight,text:CN.orange},FOH:{bg:CN.blueLight,text:CN.blue},
  Management:{bg:CN.purpleLight,text:CN.purple},Other:{bg:CN.creamDark,text:CN.mid},
};
function Tag({cat,small}){
  const cs=CAT_STYLE[cat]||CAT_STYLE.Other;
  return<span style={{display:"inline-block",padding:small?"1px 7px":"2px 10px",borderRadius:"99px",fontSize:small?"10px":"11px",fontWeight:700,backgroundColor:cs.bg,color:cs.text}}>{cat}</span>;
}

const baseInp={border:`1.5px solid ${CN.border}`,borderRadius:"8px",padding:"8px 12px",fontSize:"13px",width:"100%",boxSizing:"border-box",outline:"none",backgroundColor:CN.white,fontFamily:"'Barlow Semi Condensed',sans-serif",color:CN.dark};

function Field({label,note,type="text",value,onChange,min,max,step,placeholder,style={},disabled}){
  const[foc,setFoc]=useState(false);
  return(
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

function Pick({label,value,onChange,options}){
  return(
    <div style={{marginBottom:"12px"}}>
      {label&&<label style={{fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,display:"block",marginBottom:"4px"}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)} style={{...baseInp}}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
    </div>
  );
}

function Btn({onClick,children,variant="primary",style={},disabled}){
  const base={border:"none",borderRadius:"8px",padding:"8px 18px",fontSize:"12px",fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Bowlby One SC',sans-serif",transition:"all 0.15s"};
  const v={
    primary:{...base,backgroundColor:CN.orange,color:CN.white},
    secondary:{...base,backgroundColor:CN.creamDark,color:CN.dark},
    ghost:{...base,backgroundColor:"transparent",color:CN.blue,padding:"3px 0"},
    danger:{...base,backgroundColor:"transparent",color:CN.red,padding:"3px 0"},
  };
  return<button onClick={onClick} disabled={disabled} style={{...v[variant],...style,opacity:disabled?0.4:1,cursor:disabled?"not-allowed":"pointer"}}>{children}</button>;
}

function Card({children,style={}}){
  return<div style={{backgroundColor:CN.white,border:`1.5px solid ${CN.border}`,borderRadius:"14px",padding:"20px",marginBottom:"14px",...style}}>{children}</div>;
}

function SHead({title,sub}){
  return<div style={{marginBottom:"20px"}}>
    <h2 style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:"22px",textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,margin:0}}>{title}</h2>
    {sub&&<p style={{fontSize:"13px",color:CN.mid,marginTop:"4px",margin:"4px 0 0"}}>{sub}</p>}
  </div>;
}

function Sub({children,style={}}){
  return<h3 style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:700,fontSize:"15px",textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,margin:"0 0 12px",...style}}>{children}</h3>;
}

function Note({children,type="info"}){
  const s={info:{bg:CN.creamDark,border:CN.border,text:CN.mid},warning:{bg:CN.amberLight,border:CN.amber,text:"#92400E"},alert:{bg:CN.orangeLight,border:CN.orange,text:CN.orangeHover},success:{bg:CN.greenLight,border:CN.green,text:CN.green}};
  const st=s[type]||s.info;
  return<div style={{backgroundColor:st.bg,border:`1px solid ${st.border}`,borderRadius:"8px",padding:"10px 14px",fontSize:"12px",color:st.text,marginBottom:"12px"}}>{children}</div>;
}

// ── Page header (inside main content) ────────────────────────────
function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      marginBottom: 24, paddingBottom: 20, borderBottom: `1.5px solid ${CN.border}`,
      flexWrap: "wrap", gap: 12,
    }}>
      <div>
        <h1 style={{
          fontFamily: "'Bowlby One SC',sans-serif", fontWeight: 800, fontSize: 28,
          textTransform: "uppercase", letterSpacing: "0.06em", color: CN.dark, margin: 0,
        }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: CN.mid, marginTop: 4, margin: "4px 0 0" }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

// ── Save bar ──────────────────────────────────────────────────────
function SaveBar({dirty,onSave,onClear,saving,isMobile}){
  const[confirmClear,setConfirmClear]=useState(false);
  const handleClear=()=>{if(confirmClear){onClear();setConfirmClear(false);}else setConfirmClear(true);};
  useEffect(()=>{if(!dirty)setConfirmClear(false);},[dirty]);
  if (!dirty && !saving) return null;
  const bar={
    display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",marginTop:24,
    ...(isMobile?{position:"fixed",bottom:0,left:0,right:0,zIndex:100,backgroundColor:CN.white,borderTop:`2px solid ${CN.orange}`,padding:"12px 16px",boxShadow:"0 -4px 20px rgba(0,0,0,0.1)"}:{borderTop:`1.5px solid ${CN.border}`,paddingTop:"16px"}),
  };
  return(
    <div style={bar}>
      <div style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"12px",color:CN.orange,fontWeight:600}}>
        <span style={{width:"7px",height:"7px",borderRadius:"50%",backgroundColor:CN.orange,display:"inline-block"}}/>
        Unsaved changes
      </div>
      <div style={{display:"flex",gap:"8px"}}>
        <button onClick={handleClear} style={{padding:"7px 14px",border:`1.5px solid ${confirmClear?CN.red:CN.border}`,borderRadius:"8px",backgroundColor:confirmClear?"#FFE0D8":CN.white,color:confirmClear?CN.red:CN.mid,fontSize:"12px",fontWeight:700,cursor:"pointer",fontFamily:"'Bowlby One SC',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>
          {confirmClear?"Confirm clear":"Clear"}
        </button>
        <button onClick={onSave} disabled={!dirty||saving} style={{padding:"7px 18px",border:"none",borderRadius:"8px",backgroundColor:dirty&&!saving?CN.orange:CN.creamDark,color:dirty&&!saving?CN.white:CN.mid,fontSize:"12px",fontWeight:700,cursor:dirty&&!saving?"pointer":"default",fontFamily:"'Bowlby One SC',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em",minWidth:"70px"}}>
          {saving?"Saving…":"Save"}
        </button>
      </div>
    </div>
  );
}

// ── Scenario selector ─────────────────────────────────────────────
// ── Radix shared styles ───────────────────────────────────────────
const OVERLAY_STYLE = {
  position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.5)",zIndex:2000,
};
const MODAL_STYLE = {
  position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
  backgroundColor:CN.white,borderRadius:14,padding:24,
  maxWidth:380,width:"calc(100% - 40px)",
  boxShadow:"0 16px 48px rgba(0,0,0,0.2)",zIndex:2001,
  fontFamily:"'Barlow Semi Condensed',sans-serif",outline:"none",
};

// Reusable confirmation dialog (destructive or neutral)
function ConfirmDialog({open,onOpenChange,icon,title,description,confirmLabel="Confirm",onConfirm,destructive}){
  return(
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay style={OVERLAY_STYLE}/>
        <AlertDialog.Content style={MODAL_STYLE}>
          {icon&&<div style={{fontSize:28,marginBottom:8}}>{icon}</div>}
          <AlertDialog.Title style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:18,color:CN.dark,marginBottom:8,textTransform:"uppercase",margin:"0 0 8px"}}>{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <p style={{fontSize:13,color:CN.mid,marginBottom:20,lineHeight:1.6,margin:"0 0 20px"}}>{description}</p>
          </AlertDialog.Description>
          <div style={{display:"flex",gap:8}}>
            <AlertDialog.Action asChild>
              <Btn onClick={onConfirm} style={destructive?{backgroundColor:CN.red}:{}}>{confirmLabel}</Btn>
            </AlertDialog.Action>
            <AlertDialog.Cancel asChild>
              <Btn variant="secondary">Cancel</Btn>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// Reusable text-input dialog (create / rename)
function InputDialog({open,onOpenChange,title,placeholder,defaultValue,onConfirm,confirmLabel="Confirm"}){
  const[value,setValue]=useState(defaultValue||"");
  useEffect(()=>{if(open)setValue(defaultValue||"");},[open,defaultValue]);
  const commit=()=>{if(value.trim()){onConfirm(value.trim());onOpenChange(false);}};
  return(
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={{...OVERLAY_STYLE,zIndex:300}}/>
        <Dialog.Content style={{...MODAL_STYLE,zIndex:301,maxWidth:340}}>
          <Dialog.Title style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:18,color:CN.dark,marginBottom:16,textTransform:"uppercase",margin:"0 0 16px"}}>{title}</Dialog.Title>
          <input
            autoFocus value={value}
            onChange={e=>setValue(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")commit();}}
            placeholder={placeholder}
            style={{...baseInp,marginBottom:12}}
          />
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={commit} style={{opacity:value.trim()?1:0.4}}>{confirmLabel}</Btn>
            <Dialog.Close asChild><Btn variant="secondary">Cancel</Btn></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Radix Tooltip — replaces hand-rolled InfoTip
function RTip({source,url}){
  return(
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <span style={{cursor:"pointer",fontSize:11,color:CN.blue,fontWeight:700,width:16,height:16,borderRadius:"50%",border:`1px solid ${CN.blue}`,display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,marginLeft:4,flexShrink:0,verticalAlign:"middle"}}>
          i
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          style={{
            backgroundColor:CN.dark,color:CN.white,borderRadius:8,
            padding:"8px 12px",fontSize:11,zIndex:9999,maxWidth:260,
            lineHeight:1.5,boxShadow:"0 4px 16px rgba(0,0,0,0.35)",
            pointerEvents:"none",
          }}
        >
          <div style={{fontWeight:600,marginBottom:4}}>Source</div>
          <div style={{opacity:0.85,marginBottom:url?6:0}}>{source}</div>
          {url&&<div style={{color:"#7DD3C8",fontSize:10,wordBreak:"break-all"}}>{url}</div>}
          <Tooltip.Arrow style={{fill:CN.dark}}/>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ScenarioSelector({scenarios,activeId,onSwitch,onCreate,onDelete,onRename,canRename,label="Scenario"}){
  const[createOpen,setCreateOpen]=useState(false);
  const[renameTarget,setRenameTarget]=useState(null);
  const[deleteTarget,setDeleteTarget]=useState(null);
  const active=scenarios.find(s=>s.id===activeId);

  const itemHoverStyle=(isActive)=>({
    display:"flex",alignItems:"center",justifyContent:"space-between",
    padding:"8px 10px",
    backgroundColor:isActive?CN.orangeLight:"transparent",
    borderBottom:`1px solid ${CN.creamDark}`,
    gap:6,
    transition:"background 0.1s",
  });

  return(
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.mid}}>{label}:</span>

      <Popover.Root>
        <Popover.Trigger asChild>
          <button style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",backgroundColor:CN.white,border:`1.5px solid ${CN.orange}`,borderRadius:"8px",cursor:"pointer",fontFamily:"'Barlow Semi Condensed',sans-serif",fontSize:"13px",fontWeight:600,color:CN.dark,minWidth:"160px",justifyContent:"space-between",outline:"none"}}>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{active?.name||"Select…"}</span>
            <span style={{fontSize:"10px",color:CN.mid,flexShrink:0}}>▼</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            style={{
              backgroundColor:CN.white,borderRadius:10,
              boxShadow:"0 8px 32px rgba(0,0,0,0.15)",
              border:`1px solid ${CN.border}`,
              minWidth:220,zIndex:201,overflow:"hidden",outline:"none",
            }}
          >
            {scenarios.map(s=>{
              const isActive=s.id===activeId;
              const canRen=!canRename||canRename(s.id);
              return(
                <div key={s.id} style={itemHoverStyle(isActive)}>
                  <Popover.Close asChild>
                    <button onClick={()=>onSwitch(s.id)} style={{flex:1,textAlign:"left",background:"none",border:"none",cursor:"pointer",fontSize:"13px",fontWeight:isActive?700:400,color:isActive?CN.orange:CN.dark,fontFamily:"'Barlow Semi Condensed',sans-serif",padding:0,outline:"none"}}>
                      {isActive?"✓ ":""}{s.name}
                    </button>
                  </Popover.Close>
                  <div style={{display:"flex",gap:3,flexShrink:0}}>
                    {onRename&&canRen&&(
                      <Popover.Close asChild>
                        <button onClick={()=>setRenameTarget({id:s.id,name:s.name})} style={{fontSize:"11px",color:CN.mid,background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:4,lineHeight:1}} title="Rename">✏️</button>
                      </Popover.Close>
                    )}
                    {scenarios.length>1&&(
                      <Popover.Close asChild>
                        <button onClick={()=>setDeleteTarget({id:s.id,name:s.name})} style={{fontSize:"11px",color:CN.mid,background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:4,lineHeight:1}} title="Delete">🗑</button>
                      </Popover.Close>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{padding:"8px",borderTop:`1px solid ${CN.border}`,fontSize:"11px",color:CN.mid,textAlign:"center"}}>{scenarios.length}/{MAX_SCENARIOS} scenarios</div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {scenarios.length<MAX_SCENARIOS&&(
        <button onClick={()=>setCreateOpen(true)} style={{padding:"7px 10px",backgroundColor:CN.orange,border:"none",borderRadius:"8px",color:CN.white,cursor:"pointer",fontSize:"14px",fontWeight:700,lineHeight:1}}>+</button>
      )}

      <InputDialog
        open={createOpen} onOpenChange={setCreateOpen}
        title="New Scenario" placeholder="e.g. Peak Season, Lean Week…"
        onConfirm={onCreate} confirmLabel="Create"
      />

      <InputDialog
        open={!!renameTarget} onOpenChange={v=>!v&&setRenameTarget(null)}
        title="Rename Scenario" defaultValue={renameTarget?.name}
        onConfirm={val=>{if(onRename)onRename(renameTarget.id,val);}}
        confirmLabel="Rename"
      />

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={v=>!v&&setDeleteTarget(null)}
        icon="🗑" title="Delete Scenario"
        description={<>Permanently delete <strong>"{deleteTarget?.name}"</strong>? This cannot be undone.</>}
        confirmLabel="Delete"
        onConfirm={()=>{onDelete(deleteTarget.id);setDeleteTarget(null);}}
        destructive
      />
    </div>
  );
}

const TH={padding:"9px 8px",backgroundColor:CN.creamDark,border:`1px solid ${CN.border}`,fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,fontFamily:"'Barlow Semi Condensed',sans-serif",whiteSpace:"nowrap"};
const TD={padding:"0",fontSize:"13px",fontFamily:"'Barlow Semi Condensed',sans-serif",verticalAlign:"middle",border:`1px solid ${CN.creamDark}`};

// ── Role Form ─────────────────────────────────────────────────────
function RoleForm({initial,onSave,onCancel,taxForYear,ot}){
  const blank={name:"",category:"BOH",payType:"Hourly",rate:"",defaultHours:35,otEligible:true,exempt:false,isMinor:false,benefits:{...DEFAULT_BENEFITS},active:true};
  const[f,setF]=useState(initial?{...initial,benefits:{...DEFAULT_BENEFITS,...(initial.benefits||{})}}:blank);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const setB=(k,v)=>setF(p=>({...p,benefits:{...p.benefits,[k]:v}}));
  const activeTax=taxForYear||DEFAULT_TAX;
  const taxOk=activeTax?.finalized!==false;
  const minorWageSet=activeTax.minWageMinor>0;
  const effectiveMinWage=f.isMinor&&minorWageSet?activeTax.minWageMinor:activeTax.minWage||DEFAULT_TAX.minWage;
  const minW=f.payType==="Hourly"&&Number(f.rate)>0&&Number(f.rate)<effectiveMinWage;
  const minorBlocksSalary=f.isMinor&&f.payType==="Salary";
  const exemptThreshold=ot?.nonExemptWeeklyMin||DEFAULT_OT.nonExemptWeeklyMin;
  const weeklyEquiv=f.payType==="Salary"?(Number(f.rate)||0)/4.33:null;
  const forcedNonExempt=f.payType==="Salary"&&weeklyEquiv!==null&&weeklyEquiv<exemptThreshold;
  const effectiveExempt=forcedNonExempt?false:f.exempt;
  const valid=f.name.trim()&&f.rate!==""&&Number(f.rate)>0&&taxOk&&!minorBlocksSalary;
  const previewDays=DAYS.reduce((a,d,i)=>({...a,[d]:i<5?(f.defaultHours||0)/5:0}),{});
  const prev=f.name.trim()&&f.rate!==""&&Number(f.rate)>0?calcRowCost({...f,exempt:effectiveExempt,rate:Number(f.rate)},previewDays,activeTax,ot):null;
  const handlePayType=(v)=>{set("payType",v);if(v==="Salary"){set("otEligible",false);set("exempt",true);}else{set("otEligible",true);set("exempt",false);}};
  const handleMinorToggle=(checked)=>{set("isMinor",checked);if(checked&&f.payType==="Salary"){set("payType","Hourly");set("otEligible",true);set("exempt",false);}};
  return(
    <Card style={{border:`1.5px solid ${CN.orange}`,marginBottom:"12px"}}>
      <Sub>{initial?"Edit Role":"Add New Role"}</Sub>
      {!taxOk&&<Note type="alert">⚠️ Finalize Tax & Regulations settings before adding roles.</Note>}
      {minW&&<Note type="alert">⚠️ Rate ${f.rate}/hr is below the {f.isMinor?"minor":"WA"} minimum wage of ${effectiveMinWage}/hr.</Note>}
      {minorBlocksSalary&&<Note type="alert">⚠️ Workers under 16 cannot hold salaried-exempt positions under WA law.</Note>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <div style={{gridColumn:"1/-1"}}><Field label="Job Title" value={f.name} onChange={v=>set("name",v)} placeholder="e.g. Line Cook"/></div>
        <Pick label="Category" value={f.category} onChange={v=>set("category",v)} options={CATEGORIES}/>
        <Pick label="Pay Type" value={f.payType} onChange={handlePayType} options={f.isMinor?["Hourly"]:PAY_TYPES}/>
        <Field label={f.payType==="Hourly"?"Hourly Rate ($)":"Monthly Salary ($)"} type="number" value={f.rate} onChange={v=>set("rate",v)} min={0} step={0.5}/>
        {f.payType==="Hourly"&&<Field label="Default Hrs/Week" type="number" value={f.defaultHours} onChange={v=>set("defaultHours",v)} min={0} max={f.isMinor?MINOR_WEEKLY_MAX:undefined} step={1}/>}
      </div>
      <div style={{marginBottom:"12px",padding:"12px 14px",backgroundColor:f.isMinor?CN.amberLight:CN.creamDark,borderRadius:8,border:`1px solid ${f.isMinor?CN.amber:CN.border}`}}>
        <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
          <input type="checkbox" checked={!!f.isMinor} onChange={e=>handleMinorToggle(e.target.checked)} style={{width:15,height:15,accentColor:CN.amber}}/>
          <div>
            <div style={{fontWeight:700,fontSize:"13px",color:CN.dark}}>Minor (under 16)</div>
            <div style={{fontSize:"11px",color:CN.mid,marginTop:2}}>Caps weekly hours at {MINOR_WEEKLY_MAX}h. Applies minor minimum wage if set.</div>
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
          {forcedNonExempt&&<Note type="warning">⚠️ Monthly salary = {fmt$(weeklyEquiv||0)}/wk — below WA exempt threshold of {fmt$(exemptThreshold)}/wk. Must be Nonexempt.</Note>}
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            <label style={{display:"flex",alignItems:"flex-start",gap:"10px",cursor:forcedNonExempt?"not-allowed":"pointer",padding:"10px",backgroundColor:effectiveExempt?CN.purpleLight:"transparent",borderRadius:"8px",border:`1px solid ${effectiveExempt?CN.purple:CN.border}`,opacity:forcedNonExempt?0.4:1}}>
              <input type="radio" checked={effectiveExempt} disabled={forcedNonExempt} onChange={()=>set("exempt",true)} style={{marginTop:"2px",accentColor:CN.purple}}/>
              <div><div style={{fontWeight:600,fontSize:"13px",color:CN.dark}}>Exempt</div><div style={{fontSize:"11px",color:CN.mid,marginTop:"2px"}}>Salary ≥ {fmt$(exemptThreshold)}/wk. No OT owed.</div></div>
            </label>
            <label style={{display:"flex",alignItems:"flex-start",gap:"10px",cursor:"pointer",padding:"10px",backgroundColor:!effectiveExempt?CN.amberLight:"transparent",borderRadius:"8px",border:`1px solid ${!effectiveExempt?CN.amber:CN.border}`}}>
              <input type="radio" checked={!effectiveExempt} onChange={()=>set("exempt",false)} style={{marginTop:"2px",accentColor:CN.amber}}/>
              <div><div style={{fontWeight:600,fontSize:"13px",color:CN.dark}}>Nonexempt Salaried</div><div style={{fontSize:"11px",color:CN.mid,marginTop:"2px"}}>OT applies after {ot?.weeklyThreshold||40} hrs/week.</div></div>
            </label>
          </div>
        </Card>
      )}
      <div style={{borderTop:`1px solid ${CN.border}`,paddingTop:"16px",marginTop:"4px"}}>
        <Sub>Benefits (Employer Cost)</Sub>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0 16px"}}>
          <Field label="Health ($/mo)" type="number" value={f.benefits.healthMonthly} onChange={v=>setB("healthMonthly",v)} min={0} step={10}/>
          <Field label="Dental ($/mo)" type="number" value={f.benefits.dentalMonthly} onChange={v=>setB("dentalMonthly",v)} min={0} step={5}/>
          <Field label="Vision ($/mo)" type="number" value={f.benefits.visionMonthly} onChange={v=>setB("visionMonthly",v)} min={0} step={5}/>
          <Field label="401k Match (%)" type="number" value={f.benefits.retirement401k} onChange={v=>setB("retirement401k",v)} min={0} step={0.5} note="% of gross wages"/>
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
              <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:"24px",fontWeight:800,color:CN.orange}}>{fmt$(prev.total)}</div>
            </div>
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:"8px"}}>
        <Btn onClick={()=>valid&&onSave({...f,id:initial?.id||uid(),rate:Number(f.rate),exempt:effectiveExempt})} style={{opacity:valid?1:0.4}}>{initial?"Save Changes":"Add Role"}</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────
function RolesTab({roleScenarios,setRoleScenarios,taxYears,ot,dirty,onSave,onClear,saving,isMobile,isAdmin}){
  const[adding,setAdding]=useState(false);
  const[editing,setEditing]=useState(null);
  const[adminSaveConfirm,setAdminSaveConfirm]=useState(false);
  const activeScenario=roleScenarios.scenarios.find(s=>s.id===roleScenarios.activeId);
  const roles=activeScenario?.roles||[];
  const isDefault=!!activeScenario?.isDefault;
  const readOnly=isDefault&&!isAdmin;
  const currentYear=new Date().getFullYear();
  const taxForYear=taxYears?.[currentYear]||null;
  const updateRoles=(fn)=>setRoleScenarios(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===prev.activeId?{...s,roles:fn(s.roles)}:s)}));
  const saveRole=(role)=>{updateRoles(rs=>rs.find(r=>r.id===role.id)?rs.map(r=>r.id===role.id?role:r):[...rs,role]);setAdding(false);setEditing(null);};
  const toggle=(id)=>updateRoles(rs=>rs.map(r=>r.id===id?{...r,active:!r.active}:r));
  const[confirmRemoveId,setConfirmRemoveId]=useState(null);
  const remove=(id)=>setConfirmRemoveId(id);
  const grouped=CATEGORIES.reduce((a,c)=>{a[c]=roles.filter(r=>r.category===c);return a;},{});
  const handleCreateScenario=(name)=>{const newS=makeRoleScenario(name,[]);setRoleScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));};
  const handleDeleteScenario=(id)=>setRoleScenarios(prev=>{const remaining=prev.scenarios.filter(s=>s.id!==id);return{scenarios:remaining,activeId:prev.activeId===id?remaining[0]?.id||null:prev.activeId};});
  const copyDefaultToNew=()=>{const name=`Custom — ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;const newS=makeRoleScenario(name,roles,false);setRoleScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));};
  return(
    <div>
      <ConfirmDialog
        open={adminSaveConfirm} onOpenChange={setAdminSaveConfirm}
        icon="⚠️" title="Save Default Roles"
        description={<>Saving changes to the <strong>Default</strong> scenario affects all users who haven't created a custom scenario. Continue?</>}
        confirmLabel="Confirm Save"
        onConfirm={()=>{onSave();setAdminSaveConfirm(false);}}
      />
      <ConfirmDialog
        open={!!confirmRemoveId} onOpenChange={v=>!v&&setConfirmRemoveId(null)}
        icon="🗑" title="Remove Role"
        description="Remove this role from the scenario? This cannot be undone."
        confirmLabel="Remove"
        onConfirm={()=>{updateRoles(rs=>rs.filter(r=>r.id!==confirmRemoveId));setConfirmRemoveId(null);}}
        destructive
      />
      <PageHeader
        title="Job Roles"
        subtitle="Define roles and pay rates per scenario"
        actions={<ScenarioSelector scenarios={roleScenarios.scenarios} activeId={roleScenarios.activeId} onSwitch={id=>setRoleScenarios(prev=>({...prev,activeId:id}))} onCreate={handleCreateScenario} onDelete={handleDeleteScenario} onRename={(id,name)=>setRoleScenarios(prev=>{const t=prev.scenarios.find(s=>s.id===id);if(t?.isDefault&&!isAdmin)return prev;return{...prev,scenarios:prev.scenarios.map(s=>s.id===id?{...s,name}:s)};})
        } canRename={id=>{const s=roleScenarios.scenarios.find(x=>x.id===id);return !s?.isDefault||isAdmin;}} label="Role Scenario"/>}
      />
      {!roleScenarios.scenarios.some(s=>!s.isDefault)&&<Note type="warning">⚠️ No custom role scenario yet. Copy the Default to create your own editable scenario.</Note>}
      {isDefault&&!isAdmin&&<Note type="info">This is the <strong>Default</strong> scenario — read only. Copy it to create your own.</Note>}
      {activeScenario&&(
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {(!isDefault||isAdmin)&&!adding&&!editing&&<Btn onClick={()=>setAdding(true)}>+ Add Role</Btn>}
          {isDefault&&<Btn variant="secondary" onClick={copyDefaultToNew}>Copy to New Scenario</Btn>}
        </div>
      )}
      {adding&&<RoleForm onSave={saveRole} onCancel={()=>setAdding(false)} taxForYear={taxForYear} ot={ot}/>}
      {CATEGORIES.map(cat=>grouped[cat]?.length===0?null:(
        <div key={cat} style={{marginBottom:"24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}><Tag cat={cat}/><span style={{fontSize:"12px",color:CN.mid}}>{grouped[cat].length} role{grouped[cat].length!==1?"s":""}</span></div>
          {grouped[cat].map(role=>(
            editing===role.id
              ?<RoleForm key={role.id} initial={role} onSave={saveRole} onCancel={()=>setEditing(null)} taxForYear={taxForYear} ot={ot}/>
              :(
                <Card key={role.id} style={{padding:"14px 18px",opacity:role.active?1:0.5,marginBottom:"8px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:"140px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"3px",flexWrap:"wrap"}}>
                        <span style={{fontWeight:600,fontSize:"14px",color:CN.dark}}>{role.name}</span>
                        {role.payType==="Salary"&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:role.exempt?CN.purpleLight:CN.amberLight,color:role.exempt?CN.purple:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>{role.exempt?"Exempt":"Nonexempt"}</span>}
                        {role.payType==="Hourly"&&role.otEligible&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:CN.amberLight,color:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>OT eligible</span>}
                        {role.isMinor&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:"#FFF5CC",color:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>⚠ Minor &lt;16</span>}
                        {!role.active&&<span style={{fontSize:"11px",color:CN.mid}}>(inactive)</span>}
                      </div>
                      <div style={{fontSize:"12px",color:CN.mid}}>{role.payType==="Hourly"?`${fmt$(role.rate)}/hr · ${role.defaultHours}h/wk default`:`${fmt$(role.rate)}/mo salary`}</div>
                    </div>
                    <div style={{textAlign:"right",marginRight:"8px"}}>
                      <div style={{fontSize:"10px",color:CN.mid}}>Weekly all-in (1 emp.)</div>
                      <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:"18px",fontWeight:800,color:CN.orange}}>{fmt$(calcRowCost(role,DAYS.reduce((a,d,i)=>({...a,[d]:i<5?role.defaultHours/5:0}),{}),taxForYear||DEFAULT_TAX,ot).total)}</div>
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
        <div style={{textAlign:"center",padding:"56px",color:CN.mid}}><div style={{fontSize:"48px",marginBottom:"12px"}}>👥</div><p>No roles in this scenario.</p></div>
      )}
      <SaveBar dirty={dirty} onSave={isDefault&&isAdmin?()=>setAdminSaveConfirm(true):onSave} onClear={onClear} saving={saving} isMobile={isMobile}/>
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}

// ── Plan Tab ──────────────────────────────────────────────────────
function PlanTab({roleScenarios,planScenarios,setPlanScenarios,taxYears,ot,dirty,onSave,onClear,saving,isMobile,isAdmin}){
  const[selectedWeek,setSelectedWeek]=useState(isoMonday(toMonday(new Date())));
  const[activeDayIdx,setActiveDayIdx]=useState(()=>{const d=new Date().getDay();return d===0?6:d-1;});
  const[adminSaveConfirm,setAdminSaveConfirm]=useState(false);
  const activePlanScenario=planScenarios.scenarios.find(s=>s.id===planScenarios.activeId);
  const linkedRoleScenarioId=activePlanScenario?.roleScenarioId;
  const linkedRoleScenario=roleScenarios.scenarios.find(s=>s.id===linkedRoleScenarioId);
  const availableRoles=(linkedRoleScenario?.roles||[]).filter(r=>r.active);
  const isDefault=!!activePlanScenario?.isDefault;
  const readOnly=isDefault&&!isAdmin;
  const weekYear=parseInt(selectedWeek.slice(0,4));
  const tax=taxYears?.[weekYear]||null;
  const taxFinalized=!!tax?.finalized;
  const weekPlans=activePlanScenario?.plans.filter(p=>p.weekOf===selectedWeek)||[];
  const updatePlans=(fn)=>setPlanScenarios(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===prev.activeId?{...s,plans:fn(s.plans)}:s)}));
  const updateDay=(planId,day,val)=>{
    const num=val===""?"":(Math.round(parseFloat(val)*2)/2);
    updatePlans(ps=>ps.map(p=>{
      if(p.id!==planId)return p;
      const role=availableRoles.find(r=>r.id===p.roleId);
      if(role?.isMinor&&num!==""){const otherDaysTotal=DAYS.filter(d=>d!==day).reduce((s,d)=>s+(parseFloat(p.days[d])||0),0);const allowed=Math.max(0,MINOR_WEEKLY_MAX-otherDaysTotal);return{...p,days:{...p.days,[day]:Math.min(num,allowed)}};}
      return{...p,days:{...p.days,[day]:num}};
    }));
  };
  const addRow=(roleId)=>updatePlans(ps=>[...ps,{id:uid(),weekOf:selectedWeek,roleId,days:emptyDays()}]);
  const removeRow=(planId)=>updatePlans(ps=>ps.filter(p=>p.id!==planId));
  const shift=(n)=>{const d=new Date(selectedWeek+"T00:00:00");d.setDate(d.getDate()+n*7);setSelectedWeek(isoMonday(d));};
  const copyPrev=()=>{const prev=new Date(selectedWeek+"T00:00:00");prev.setDate(prev.getDate()-7);const prevStr=isoMonday(prev);const prevPlans=(activePlanScenario?.plans||[]).filter(p=>p.weekOf===prevStr);if(!prevPlans.length){alert("No plan found for previous week.");return;}updatePlans(ps=>[...ps.filter(p=>p.weekOf!==selectedWeek),...prevPlans.map(p=>({...p,id:uid(),weekOf:selectedWeek}))]);};
  const O=ot||DEFAULT_OT;
  const visiblePlans=weekPlans.filter(p=>availableRoles.find(r=>r.id===p.roleId));
  const totals=visiblePlans.reduce((acc,plan)=>{const role=availableRoles.find(r=>r.id===plan.roleId);if(!role)return acc;const c=calcRowCost(role,plan.days,tax,ot);return{wages:acc.wages+c.wages,taxes:acc.taxes+c.taxes,benefits:acc.benefits+c.benefits,total:acc.total+c.total,otHrs:acc.otHrs+c.otHrs,totalHrs:acc.totalHrs+c.totalHrs};},{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});
  const dayTotals=DAYS.reduce((acc,d)=>({...acc,[d]:visiblePlans.reduce((s,p)=>s+(parseFloat(p.days[d])||0),0)}),{});
  const grouped=CATEGORIES.reduce((a,c)=>({...a,[c]:availableRoles.filter(r=>r.category===c)}),{});
  const handleCreatePlanScenario=(name)=>{const newS=makePlanScenario(name,linkedRoleScenarioId||null);setPlanScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));};
  const handleDeletePlanScenario=(id)=>setPlanScenarios(prev=>{const remaining=prev.scenarios.filter(s=>s.id!==id);return{scenarios:remaining,activeId:prev.activeId===id?remaining[0]?.id||null:prev.activeId};});
  const copyDefaultToNew=()=>{const name=`Custom — ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;const newS=makePlanScenario(name,linkedRoleScenarioId||null,false);newS.plans=(activePlanScenario?.plans||[]).map(p=>({...p,id:uid()}));setPlanScenarios(prev=>({scenarios:[...prev.scenarios,newS],activeId:newS.id}));};
  return(
    <div>
      <ConfirmDialog
        open={adminSaveConfirm} onOpenChange={setAdminSaveConfirm}
        icon="⚠️" title="Save Default Schedule"
        description={<>Saving the <strong>Default</strong> schedule affects all users. Continue?</>}
        confirmLabel="Confirm Save"
        onConfirm={()=>{onSave();setAdminSaveConfirm(false);}}
      />
      <PageHeader
        title="Weekly Schedule"
        subtitle="Enter hours per employee per day"
        actions={
          <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
            <ScenarioSelector scenarios={planScenarios.scenarios} activeId={planScenarios.activeId} onSwitch={id=>setPlanScenarios(prev=>({...prev,activeId:id}))} onCreate={handleCreatePlanScenario} onDelete={handleDeletePlanScenario} onRename={(id,name)=>setPlanScenarios(prev=>{const t=prev.scenarios.find(s=>s.id===id);if(t?.isDefault&&!isAdmin)return prev;return{...prev,scenarios:prev.scenarios.map(s=>s.id===id?{...s,name}:s)};})
            } canRename={id=>{const s=planScenarios.scenarios.find(x=>x.id===id);return !s?.isDefault||isAdmin;}} label="Schedule Scenario"/>
            {activePlanScenario&&(
              <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                <span style={{fontSize:"11px",color:CN.mid}}>Roles from:</span>
                <select value={linkedRoleScenarioId||""} onChange={e=>{const rid=e.target.value;setPlanScenarios(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===prev.activeId?{...s,roleScenarioId:rid}:s)}));}} style={{...baseInp,width:"auto",fontSize:"12px",padding:"4px 8px"}}>
                  <option value="">— select —</option>
                  {roleScenarios.scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        }
      />
      {!planScenarios.scenarios.some(s=>!s.isDefault)&&<Note type="warning">⚠️ No custom schedule scenario yet.</Note>}
      {isDefault&&!isAdmin&&<Note type="info">This is the <strong>Default</strong> schedule — read only.<span style={{marginLeft:8}}><Btn variant="secondary" onClick={copyDefaultToNew} style={{fontSize:11,padding:"3px 10px"}}>Copy to New</Btn></span></Note>}
      {!activePlanScenario&&<Note type="alert">Create a schedule scenario to start planning.</Note>}
      {activePlanScenario&&!linkedRoleScenario&&<Note type="alert">⚠️ Select a Job Role Scenario above.</Note>}
      {activePlanScenario&&linkedRoleScenario&&availableRoles.length===0&&<Note type="warning">No active roles in the selected scenario.</Note>}
      {activePlanScenario&&linkedRoleScenario&&availableRoles.length>0&&!taxFinalized&&<Note type="alert">⚠️ Tax settings for <strong>{weekYear}</strong> not finalized. Go to Taxes & Regs to unlock cost calculations.</Note>}
      {activePlanScenario&&linkedRoleScenario&&availableRoles.length>0&&taxFinalized&&(
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <Btn variant="secondary" onClick={()=>shift(-1)} style={{padding:"6px 14px"}}>←</Btn>
              <span style={{fontSize:"13px",fontWeight:600,color:CN.dark,minWidth:"200px",textAlign:"center"}}>{fmtWeek(selectedWeek)}</span>
              <Btn variant="secondary" onClick={()=>shift(1)} style={{padding:"6px 14px"}}>→</Btn>
              <Btn variant="secondary" onClick={copyPrev} style={{marginLeft:"6px",fontSize:"11px"}}>Copy prev week</Btn>
            </div>
          </div>
          <div style={{background:`linear-gradient(135deg,${CN.orange} 0%,#FF6B3A 100%)`,borderRadius:"14px",padding:"16px 24px",marginBottom:"14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"12px"}}>
              <div><div style={{fontSize:"11px",color:"rgba(255,255,255,0.75)",letterSpacing:"0.06em",textTransform:"uppercase"}}>Total Planned Labor Cost</div><div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:"34px",fontWeight:800,color:CN.white,lineHeight:1.1}}>{fmt$(totals.total)}</div></div>
              <div style={{display:"flex",gap:"20px",flexWrap:"wrap"}}>
                {[["Total Hrs",totals.totalHrs.toFixed(1)+"h"],["OT Hrs",totals.otHrs>0?totals.otHrs.toFixed(1)+"h ⚡":"0h"],["Wages",fmt$(totals.wages)],["Taxes",fmt$(totals.taxes)],["Benefits",fmt$(totals.benefits)]].map(([l,v])=>(
                  <div key={l} style={{textAlign:"right"}}><div style={{fontSize:"10px",color:"rgba(255,255,255,0.7)",textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div><div style={{fontSize:"16px",fontWeight:600,color:CN.white}}>{v}</div></div>
                ))}
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:"14px",marginBottom:"12px",flexWrap:"wrap"}}>
            {[["#FFFDF0","🔶",`Approaching OT (≥${Math.round(O.weeklyThreshold*0.85)}h)`],["#FFF5CC","⚠️",`Overtime (>${O.weeklyThreshold}h/week)`],["#FFE0D8","🚨",`Daily max exceeded (>${O.dailyMax}h/day)`]].map(([bg,icon,label])=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"11px",color:CN.mid}}><div style={{width:"13px",height:"13px",borderRadius:"3px",backgroundColor:bg,border:`1px solid ${CN.border}`,flexShrink:0}}/>{icon} {label}</div>
            ))}
          </div>
          {isMobile?(
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px",backgroundColor:CN.white,borderRadius:"12px",padding:"10px 14px",border:`1.5px solid ${CN.border}`}}>
                <button onClick={()=>setActiveDayIdx(i=>(i+6)%7)} style={{border:"none",background:CN.creamDark,borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:"16px",fontWeight:700,color:CN.dark}}>←</button>
                <div style={{textAlign:"center"}}><div style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:"20px",color:CN.dark,textTransform:"uppercase"}}>{DAY_LABELS[activeDayIdx]}</div><div style={{fontSize:"11px",color:CN.mid}}>{dayTotals[DAYS[activeDayIdx]]>0?dayTotals[DAYS[activeDayIdx]].toFixed(1)+"h total":"No hours"}</div></div>
                <button onClick={()=>setActiveDayIdx(i=>(i+1)%7)} style={{border:"none",background:CN.creamDark,borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:"16px",fontWeight:700,color:CN.dark}}>→</button>
              </div>
              <div style={{display:"flex",gap:"6px",marginBottom:"14px",justifyContent:"center"}}>
                {DAY_LABELS.map((dl,i)=>(
                  <button key={dl} onClick={()=>setActiveDayIdx(i)} style={{border:`1px solid ${i===activeDayIdx?CN.orange:CN.border}`,borderRadius:"99px",padding:"4px 10px",fontSize:"11px",fontWeight:700,cursor:"pointer",backgroundColor:i===activeDayIdx?CN.orange:dayTotals[DAYS[i]]>0?CN.creamDark:CN.white,color:i===activeDayIdx?CN.white:CN.dark}}>{dl}</button>
                ))}
              </div>
              {CATEGORIES.map(cat=>{const catRoles=grouped[cat];if(!catRoles.length)return null;return(
                <div key={cat} style={{marginBottom:"16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}><Tag cat={cat} small/></div>
                  {catRoles.map(role=>{const roleRows=weekPlans.filter(p=>p.roleId===role.id);const activeDay=DAYS[activeDayIdx];return(
                    <div key={role.id}>
                      {roleRows.map((plan,empIdx)=>{const cost=calcRowCost(role,plan.days,tax,ot);const st=rowStatus(role,plan.days,ot);const h=plan.days[activeDay];const hNum=parseFloat(h)||0;const overDay=O.dailyMax>0&&hNum>O.dailyMax;return(
                        <div key={plan.id} style={{backgroundColor:STATUS[st].rowBg,border:`1.5px solid ${overDay?CN.red:CN.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"8px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                            <div><div style={{fontWeight:600,fontSize:"14px",color:CN.dark}}>{STATUS[st].icon&&<span>{STATUS[st].icon} </span>}{role.name} <span style={{fontSize:"11px",color:CN.mid,fontWeight:400}}>#{empIdx+1}</span></div><div style={{fontSize:"11px",color:CN.mid}}>{role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo`}</div></div>
                            <div style={{textAlign:"right"}}><div style={{fontSize:"10px",color:CN.mid}}>Week cost</div><div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange}}>{cost.total>0?fmt$(cost.total):"—"}</div></div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                            <label style={{fontSize:"11px",fontWeight:600,color:CN.mid,textTransform:"uppercase",whiteSpace:"nowrap"}}>Hours {DAY_LABELS[activeDayIdx]}</label>
                            <input type="number" min={0} max={24} step={0.5} value={h} placeholder="0" onChange={e=>updateDay(plan.id,activeDay,e.target.value)} style={{flex:1,textAlign:"center",border:`1.5px solid ${overDay?CN.red:CN.border}`,borderRadius:"8px",padding:"10px",fontSize:"18px",fontWeight:700,fontFamily:"'Barlow Semi Condensed',sans-serif",backgroundColor:overDay?"#FFE0D8":CN.white,color:overDay?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}/>
                            <button onClick={()=>{if(!readOnly)removeRow(plan.id);}} style={{border:`1px solid ${CN.border}`,background:CN.white,cursor:"pointer",color:CN.mid,fontSize:"13px",padding:"8px 10px",borderRadius:"8px"}}>✕</button>
                          </div>
                          {cost.otHrs>0&&<div style={{marginTop:8,fontSize:"11px",color:CN.amberDark,fontWeight:700}}>⚡ {cost.otHrs.toFixed(1)}h OT (+{fmt$(cost.otPremium)})</div>}
                        </div>
                      );})}
                      <button onClick={()=>{if(!readOnly)addRow(role.id);}} style={{border:`1px dashed ${CN.orange}`,background:"none",cursor:"pointer",color:CN.orange,fontSize:"12px",fontWeight:700,fontFamily:"'Bowlby One SC',sans-serif",textTransform:"uppercase",padding:"8px 14px",borderRadius:"8px",width:"100%",marginBottom:"8px"}}>+ Add {role.name}</button>
                    </div>
                  );})}
                </div>
              );})}
            </div>
          ):(
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
                  const catRoles=grouped[cat];if(!catRoles.length)return null;
                  const catPlans=weekPlans.filter(p=>catRoles.find(r=>r.id===p.roleId));
                  const catTotal=catPlans.reduce((s,plan)=>{const role=availableRoles.find(r=>r.id===plan.roleId);return role?s+calcRowCost(role,plan.days,tax,ot).total:s;},0);
                  return(
                    <tbody key={cat}>
                      <tr style={{backgroundColor:CN.cream}}>
                        <td colSpan={11} style={{padding:"8px 12px",borderTop:`1px solid ${CN.border}`,borderBottom:`1px solid ${CN.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:"10px"}}><Tag cat={cat} small/><span style={{fontSize:"11px",color:CN.mid}}>{catPlans.length} employee{catPlans.length!==1?"s":""} scheduled{catTotal>0&&<strong style={{color:CN.dark,marginLeft:"6px"}}>· {fmt$(catTotal)}</strong>}</span></div>
                        </td>
                      </tr>
                      {catRoles.map(role=>{const roleRows=weekPlans.filter(p=>p.roleId===role.id);return[
                        ...roleRows.map((plan,empIdx)=>{const cost=calcRowCost(role,plan.days,tax,ot);const st=rowStatus(role,plan.days,ot);return(
                          <tr key={plan.id} style={{backgroundColor:STATUS[st].rowBg}}>
                            <td style={{...TD,padding:"8px 10px",borderLeft:"none"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                <div><div style={{fontWeight:600,color:CN.dark,fontSize:"12px"}}>{STATUS[st].icon&&<span>{STATUS[st].icon} </span>}{role.name}</div><div style={{fontSize:"10px",color:CN.mid}}>#{empIdx+1} · {role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo`}{role.payType==="Salary"&&<span style={{marginLeft:"4px",color:role.exempt?CN.purple:CN.amberDark}}>({role.exempt?"exempt":"nonexempt"})</span>}</div>{cost.otHrs>0&&<div style={{fontSize:"10px",color:CN.amberDark,fontWeight:700}}>+{cost.otHrs.toFixed(1)}h OT · +{fmt$(cost.otPremium)}</div>}</div>
                                <button onClick={()=>{if(!readOnly)removeRow(plan.id);}} style={{border:"none",background:"none",cursor:"pointer",color:CN.border,fontSize:"13px",padding:"0",lineHeight:1}}>✕</button>
                              </div>
                            </td>
                            {DAYS.map(d=>{const h=plan.days[d];const hNum=parseFloat(h)||0;const overDay=O.dailyMax>0&&hNum>O.dailyMax;const otherDaysTotal=role.isMinor?DAYS.filter(dd=>dd!==d).reduce((s,dd)=>s+(parseFloat(plan.days[dd])||0),0):0;const minorAtCap=role.isMinor&&(otherDaysTotal+hNum)>=MINOR_WEEKLY_MAX;const cellRed=overDay||minorAtCap;return(
                              <td key={d} style={{...TD,padding:"5px 4px"}}><input type="number" min={0} max={role.isMinor?Math.max(0,MINOR_WEEKLY_MAX-otherDaysTotal):24} step={0.5} value={h} placeholder="–" onChange={e=>updateDay(plan.id,d,e.target.value)} style={{width:"100%",textAlign:"center",border:`1.5px solid ${cellRed?CN.red:hNum>0?CN.border:CN.creamDark}`,borderRadius:"6px",padding:"6px 2px",fontSize:"13px",fontFamily:"'Barlow Semi Condensed',sans-serif",backgroundColor:cellRed?"#FFE0D8":hNum>0?CN.white:CN.creamDark,color:cellRed?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}/></td>
                            );})}
                            <td style={{...TD,textAlign:"center",fontWeight:600,padding:"8px",color:cost.otHrs>0?CN.amberDark:CN.dark}}>{cost.totalHrs>0?cost.totalHrs.toFixed(1)+"h":"—"}</td>
                            <td style={{...TD,textAlign:"center",fontWeight:cost.otHrs>0?700:400,padding:"8px",color:cost.otHrs>0?CN.amberDark:CN.mid}}>{cost.otHrs>0?cost.otHrs.toFixed(1)+"h ⚡":"—"}</td>
                            <td style={{...TD,textAlign:"right",fontFamily:"'Bowlby One SC',sans-serif",fontSize:"15px",fontWeight:700,color:CN.orange,borderRight:"none",padding:"8px 14px"}}>{cost.total>0?fmt$(cost.total):"—"}</td>
                          </tr>
                        );},),
                        <tr key={"add-"+role.id} style={{backgroundColor:CN.cream}}>
                          <td colSpan={11} style={{padding:"3px 8px",borderTop:`1px solid ${CN.creamDark}`}}><button onClick={()=>{if(!readOnly)addRow(role.id);}} style={{border:"none",background:"none",cursor:"pointer",color:CN.orange,fontSize:"11px",fontWeight:700,fontFamily:"'Bowlby One SC',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em",padding:"5px 8px",borderRadius:"6px"}}>+ Add {role.name}</button></td>
                        </tr>,
                      ];})}
                    </tbody>
                  );
                })}
                <tfoot>
                  <tr style={{backgroundColor:CN.creamDark}}>
                    <td style={{...TD,padding:"10px 12px",fontWeight:700,fontSize:"11px",textTransform:"uppercase",color:CN.mid,borderTop:`2px solid ${CN.border}`,borderLeft:"none",borderBottom:"none"}}>Daily Totals</td>
                    {DAYS.map(d=><td key={d} style={{...TD,textAlign:"center",fontWeight:700,color:CN.dark,borderTop:`2px solid ${CN.border}`,padding:"10px 4px",borderBottom:"none"}}>{dayTotals[d]>0?dayTotals[d].toFixed(1)+"h":"—"}</td>)}
                    <td style={{...TD,textAlign:"center",fontWeight:800,fontFamily:"'Bowlby One SC',sans-serif",fontSize:"14px",color:CN.orange,borderTop:`2px solid ${CN.border}`,padding:"10px 8px",borderBottom:"none"}}>{totals.totalHrs.toFixed(1)}h</td>
                    <td style={{...TD,textAlign:"center",fontWeight:700,color:totals.otHrs>0?CN.amberDark:CN.mid,borderTop:`2px solid ${CN.border}`,padding:"10px 8px",borderBottom:"none"}}>{totals.otHrs>0?totals.otHrs.toFixed(1)+"h ⚡":"—"}</td>
                    <td style={{...TD,textAlign:"right",fontFamily:"'Bowlby One SC',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange,borderTop:`2px solid ${CN.border}`,borderRight:"none",borderBottom:"none",padding:"10px 14px"}}>{fmt$(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {weekPlans.length===0&&<div style={{textAlign:"center",padding:"40px",color:CN.mid,marginTop:"8px"}}><p>No employees scheduled this week. Use <strong>+ Add [Role]</strong> to add rows.</p></div>}
        </>
      )}
      <SaveBar dirty={dirty} onSave={isDefault&&isAdmin?()=>setAdminSaveConfirm(true):onSave} onClear={()=>onClear(selectedWeek)} saving={saving} isMobile={isMobile}/>
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}

// ── Summary Tab (redesigned) ──────────────────────────────────────
function SummaryTab({roleScenarios,planScenarios,taxYears,ot,onRefresh}){
  const getTaxForYear=(year)=>{
    if(taxYears?.[year]?.finalized)return taxYears[year];
    const finalized=Object.entries(taxYears||{}).filter(([,v])=>v?.finalized).sort(([a],[b])=>b-a);
    return finalized.length?finalized[0][1]:DEFAULT_TAX;
  };
  const currentYear=new Date().getFullYear();
  const tax=getTaxForYear(currentYear);
  const isMobile=useIsMobile();
  const[compareIds,setCompareIds]=useState([]);
  const[activeView,setActiveView]=useState("single");

  const buildScenarioData=(planScenario)=>{
    const linkedRoles=(roleScenarios.scenarios.find(s=>s.id===planScenario.roleScenarioId)?.roles||[]).filter(r=>r.active);
    const plans=planScenario.plans;
    const weeks=[...new Set(plans.map(p=>p.weekOf))].sort();
    const weekData=weeks.map(weekOf=>{
      const weekPlans=plans.filter(p=>p.weekOf===weekOf&&linkedRoles.find(r=>r.id===p.roleId));
      const totals=weekPlans.reduce((acc,plan)=>{const role=linkedRoles.find(r=>r.id===plan.roleId);if(!role)return acc;const c=calcRowCost(role,plan.days,tax,ot);return{wages:acc.wages+c.wages,taxes:acc.taxes+c.taxes,benefits:acc.benefits+c.benefits,total:acc.total+c.total,otHrs:acc.otHrs+c.otHrs,totalHrs:acc.totalHrs+c.totalHrs};},{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});
      return{weekOf,totals,empCount:[...new Set(weekPlans.map(p=>p.id))].length};
    });
    const grandTotal=weekData.reduce((acc,w)=>({wages:acc.wages+w.totals.wages,taxes:acc.taxes+w.totals.taxes,benefits:acc.benefits+w.totals.benefits,total:acc.total+w.totals.total,otHrs:acc.otHrs+w.totals.otHrs,totalHrs:acc.totalHrs+w.totals.totalHrs}),{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});
    return{id:planScenario.id,name:planScenario.name,roleScenarioName:roleScenarios.scenarios.find(s=>s.id===planScenario.roleScenarioId)?.name||"—",weeks:weekData,grandTotal,linkedRoles};
  };

  const allScenarioData=planScenarios.scenarios.map(buildScenarioData);
  const activeScenarioId=planScenarios.activeId;
  const activeSData=allScenarioData.find(s=>s.id===activeScenarioId);
  const compareData=allScenarioData.filter(s=>compareIds.includes(s.id));

  // Current week data
  const currentWeekStr=isoMonday(toMonday(new Date()));
  const currentWeekData=activeSData?.weeks.find(w=>w.weekOf===currentWeekStr);
  const prevWeekStr=isoMonday(new Date(new Date(currentWeekStr+"T00:00:00").setDate(new Date(currentWeekStr+"T00:00:00").getDate()-7)));
  const prevWeekData=activeSData?.weeks.find(w=>w.weekOf===prevWeekStr);
  const weekDelta=currentWeekData&&prevWeekData?currentWeekData.totals.total-prevWeekData.totals.total:null;

  const exportCSV=(sData)=>{
    const rows=[["Week","Total Hours","OT Hours","Wages","Taxes","Benefits","Total Cost"]];
    sData.weeks.forEach(w=>rows.push([w.weekOf,w.totals.totalHrs.toFixed(1),w.totals.otHrs.toFixed(1),w.totals.wages.toFixed(2),w.totals.taxes.toFixed(2),w.totals.benefits.toFixed(2),w.totals.total.toFixed(2)]));
    rows.push(["TOTAL",sData.grandTotal.totalHrs.toFixed(1),sData.grandTotal.otHrs.toFixed(1),sData.grandTotal.wages.toFixed(2),sData.grandTotal.taxes.toFixed(2),sData.grandTotal.benefits.toFixed(2),sData.grandTotal.total.toFixed(2)]);
    const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${sData.name.replace(/\s+/g,"-")}-labor.csv`;a.click();URL.revokeObjectURL(url);
  };

  const maxBarVal=activeSData?Math.max(...activeSData.weeks.map(w=>w.totals.total),1):1;

  return(
    <div>
      <PageHeader
        title="Labor Summary"
        subtitle="Weekly cost history and scenario comparison"
        actions={
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <Btn variant="secondary" onClick={onRefresh}>↻ Refresh</Btn>
            <div style={{display:"flex",border:`1.5px solid ${CN.border}`,borderRadius:8,overflow:"hidden"}}>
              {[["single","Single"],["compare","Compare"]].map(([v,l])=>(
                <button key={v} onClick={()=>setActiveView(v)} style={{padding:"7px 16px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,backgroundColor:activeView===v?CN.orange:CN.white,color:activeView===v?CN.white:CN.mid,fontFamily:"'Barlow Semi Condensed',sans-serif",transition:"all 0.15s"}}>{l}</button>
              ))}
            </div>
          </div>
        }
      />

      {planScenarios.scenarios.length===0&&<Note type="alert">No schedule scenarios yet. Create one in the Schedule tab.</Note>}

      {activeView==="single"&&activeSData&&(
        <>
          {/* Current week spotlight */}
          {currentWeekData ? (
            <div style={{background:`linear-gradient(135deg,${CN.dark} 0%,#2A2A26 100%)`,borderRadius:16,padding:"20px 24px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:16}}>
              <div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>This Week · {fmtWeek(currentWeekStr)}</div>
                <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:40,fontWeight:800,color:CN.white,lineHeight:1}}>{fmt$(currentWeekData.totals.total)}</div>
                {weekDelta!==null&&(
                  <div style={{marginTop:6,fontSize:12,color:weekDelta>0?"#FF8A70":"#7DD3C8",fontWeight:600}}>
                    {weekDelta>0?"↑":"↓"} {fmt$(Math.abs(weekDelta))} vs prev week
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
                {[
                  ["Hours",currentWeekData.totals.totalHrs.toFixed(1)+"h"],
                  ["OT",currentWeekData.totals.otHrs>0?currentWeekData.totals.otHrs.toFixed(1)+"h ⚡":"None"],
                  ["Wages",fmt$(currentWeekData.totals.wages)],
                  ["Taxes",fmt$(currentWeekData.totals.taxes)],
                ].map(([l,v])=>(
                  <div key={l} style={{textAlign:"center"}}>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{l}</div>
                    <div style={{fontSize:16,fontWeight:700,color:CN.white}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{border:`2px dashed ${CN.border}`,borderRadius:14,padding:"20px 24px",marginBottom:20,display:"flex",alignItems:"center",gap:12,color:CN.mid}}>
              <span style={{fontSize:24}}>📅</span>
              <div><div style={{fontWeight:600,fontSize:13,color:CN.dark}}>No schedule for this week</div><div style={{fontSize:12}}>Add entries in the Schedule tab for {fmtWeek(currentWeekStr)}</div></div>
            </div>
          )}

          {/* Summary header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
            <div><span style={{fontSize:13,fontWeight:600,color:CN.dark}}>{activeSData.name}</span><span style={{fontSize:12,color:CN.mid,marginLeft:8}}>· Roles: {activeSData.roleScenarioName}</span></div>
            <div style={{display:"flex",gap:8}}><Btn variant="secondary" onClick={()=>exportCSV(activeSData)}>Export CSV</Btn><Btn variant="secondary" onClick={()=>window.print()}>🖨 Print</Btn></div>
          </div>

          {/* KPI strip */}
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:10,marginBottom:20}}>
            {[
              ["Total Labor Cost",fmt$(activeSData.grandTotal.total),CN.orange],
              ["Total Hours",activeSData.grandTotal.totalHrs.toFixed(1)+"h",CN.dark],
              ["OT Hours",activeSData.grandTotal.otHrs.toFixed(1)+"h",activeSData.grandTotal.otHrs>0?CN.amberDark:CN.mid],
              ["Weeks Planned",activeSData.weeks.length+"",CN.dark],
            ].map(([l,v,c])=>(
              <div key={l} style={{backgroundColor:CN.white,border:`1.5px solid ${CN.border}`,borderRadius:12,padding:"16px 18px"}}>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:CN.mid,marginBottom:6}}>{l}</div>
                <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:26,fontWeight:800,color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          {activeSData.weeks.length>0&&(
            <Card style={{marginBottom:16}}>
              <Sub>Weekly Cost Trend</Sub>
              <div style={{display:"flex",gap:"4px",alignItems:"flex-end",height:110,marginBottom:8,overflowX:"auto",paddingBottom:4}}>
                {activeSData.weeks.map(w=>{
                  const pct=(w.totals.total/maxBarVal)*100;
                  const isCurrent=w.weekOf===currentWeekStr;
                  return(
                    <div key={w.weekOf} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:"36px",flex:1}}>
                      <div style={{fontSize:9,color:isCurrent?CN.orange:CN.mid,fontWeight:isCurrent?700:400}}>{fmtK(w.totals.total)}</div>
                      <div style={{width:"100%",backgroundColor:isCurrent?CN.orange:"#C4BFB8",borderRadius:"4px 4px 0 0",height:`${Math.max(pct,2)}%`,transition:"height 0.3s",position:"relative"}}>
                        {isCurrent&&<div style={{position:"absolute",top:-20,left:"50%",transform:"translateX(-50%)",fontSize:9,color:CN.orange,fontWeight:800,whiteSpace:"nowrap"}}>← now</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:"4px",overflowX:"auto"}}>
                {activeSData.weeks.map(w=>(
                  <div key={w.weekOf} style={{minWidth:"36px",flex:1,textAlign:"center",fontSize:9,color:w.weekOf===currentWeekStr?CN.orange:CN.mid,fontWeight:w.weekOf===currentWeekStr?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>
                    {new Date(w.weekOf+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Weekly table */}
          {activeSData.weeks.length>0?(
            <div className="print-table" style={{overflowX:"auto",borderRadius:12,border:`1.5px solid ${CN.border}`}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px",minWidth:"600px"}}>
                <thead>
                  <tr>{["Week","Employees","Total Hrs","OT Hrs","Wages","Taxes","Benefits","Total Cost"].map(h=>(
                    <th key={h} style={{...TH,textAlign:h==="Week"||h==="Employees"?"left":"right"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {activeSData.weeks.map((w,i)=>{
                    const isCurrent=w.weekOf===currentWeekStr;
                    return(
                      <tr key={w.weekOf} style={{backgroundColor:isCurrent?CN.orangeLight:i%2===0?CN.white:CN.cream}}>
                        <td style={{...TD,padding:"10px 12px",borderLeft:"none",fontWeight:isCurrent?700:600,color:isCurrent?CN.orange:CN.dark,whiteSpace:"nowrap"}}>
                          {isCurrent&&<span style={{fontSize:10,backgroundColor:CN.orange,color:CN.white,padding:"1px 6px",borderRadius:99,marginRight:6,fontWeight:800}}>NOW</span>}
                          {fmtWeek(w.weekOf)}
                        </td>
                        <td style={{...TD,padding:"10px 8px",color:CN.mid}}>{w.empCount}</td>
                        <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{w.totals.totalHrs.toFixed(1)}h</td>
                        <td style={{...TD,padding:"10px 8px",textAlign:"right",color:w.totals.otHrs>0?CN.amberDark:CN.mid,fontWeight:w.totals.otHrs>0?700:400}}>{w.totals.otHrs>0?w.totals.otHrs.toFixed(1)+"h ⚡":"—"}</td>
                        <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{fmt$(w.totals.wages)}</td>
                        <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{fmt$(w.totals.taxes)}</td>
                        <td style={{...TD,padding:"10px 8px",textAlign:"right"}}>{fmt$(w.totals.benefits)}</td>
                        <td style={{...TD,padding:"10px 8px",textAlign:"right",fontFamily:"'Bowlby One SC',sans-serif",fontSize:"15px",fontWeight:700,color:isCurrent?CN.orange:CN.dark,borderRight:"none"}}>{fmt$(w.totals.total)}</td>
                      </tr>
                    );
                  })}
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
                    <td style={{...TD,padding:"12px",textAlign:"right",fontFamily:"'Bowlby One SC',sans-serif",fontSize:"18px",fontWeight:800,color:CN.orange,borderTop:`2px solid ${CN.border}`,borderRight:"none",borderBottom:"none"}}>{fmt$(activeSData.grandTotal.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ):(
            <div style={{textAlign:"center",padding:"48px",color:CN.mid}}><div style={{fontSize:"40px",marginBottom:"12px"}}>📋</div><p>No weeks planned in this scenario yet.</p></div>
          )}
        </>
      )}

      {/* Compare view */}
      {activeView==="compare"&&(
        <>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,color:CN.mid,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Select scenarios to compare (up to 5):</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {allScenarioData.map(s=>{const sel=compareIds.includes(s.id);return(
                <button key={s.id} onClick={()=>setCompareIds(prev=>sel?prev.filter(id=>id!==s.id):prev.length<5?[...prev,s.id]:prev)} style={{padding:"6px 14px",border:`1.5px solid ${sel?CN.orange:CN.border}`,borderRadius:"8px",backgroundColor:sel?CN.orangeLight:CN.white,color:sel?CN.orange:CN.dark,fontWeight:sel?700:400,fontSize:"12px",cursor:"pointer",fontFamily:"'Barlow Semi Condensed',sans-serif"}}>
                  {sel?"✓ ":""}{s.name}
                </button>
              );})}
            </div>
          </div>
          {compareData.length===0&&<Note>Select at least one scenario to compare.</Note>}
          {compareData.length>0&&(
            <>
              <div style={{display:"flex",gap:8,marginBottom:14}}><Btn variant="secondary" onClick={()=>compareData.forEach(s=>exportCSV(s))}>Export All CSV</Btn><Btn variant="secondary" onClick={()=>window.print()}>🖨 Print</Btn></div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":`repeat(${Math.min(compareData.length,3)},1fr)`,gap:10,marginBottom:16}}>
                {compareData.map((s,i)=>{const colors=[CN.orange,CN.blue,CN.purple,CN.green,"#EC4899"];const c=colors[i%colors.length];return(
                  <div key={s.id} style={{backgroundColor:CN.white,border:`2px solid ${c}`,borderRadius:14,padding:16}}>
                    <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:16,color:c,textTransform:"uppercase",marginBottom:2}}>{s.name}</div>
                    <div style={{fontSize:11,color:CN.mid,marginBottom:12}}>Roles: {s.roleScenarioName}</div>
                    {[["Total Cost",fmt$(s.grandTotal.total)],["Total Hours",s.grandTotal.totalHrs.toFixed(1)+"h"],["OT Hours",s.grandTotal.otHrs.toFixed(1)+"h"],["Weeks",s.weeks.length+""]].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",borderBottom:`1px solid ${CN.creamDark}`,padding:"6px 0",fontSize:13}}><span style={{color:CN.mid}}>{l}</span><span style={{fontWeight:700,color:CN.dark}}>{v}</span></div>
                    ))}
                  </div>
                );})}
              </div>
              <div style={{overflowX:"auto",borderRadius:12,border:`1.5px solid ${CN.border}`}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:500}}>
                  <thead><tr><th style={{...TH,textAlign:"left"}}>Metric</th>{compareData.map(s=><th key={s.id} style={{...TH,textAlign:"right"}}>{s.name}</th>)}{compareData.length===2&&<th style={{...TH,textAlign:"right"}}>Δ Diff</th>}</tr></thead>
                  <tbody>
                    {[
                      ["Total Cost",s=>fmt$(s.grandTotal.total),(a,b)=>{const d=b.grandTotal.total-a.grandTotal.total;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Total Hours",s=>s.grandTotal.totalHrs.toFixed(1)+"h",(a,b)=>{const d=b.grandTotal.totalHrs-a.grandTotal.totalHrs;return{txt:(d>=0?"+":"")+d.toFixed(1)+"h",col:CN.mid};}],
                      ["OT Hours",s=>s.grandTotal.otHrs.toFixed(1)+"h",(a,b)=>{const d=b.grandTotal.otHrs-a.grandTotal.otHrs;return{txt:(d>=0?"+":"")+d.toFixed(1)+"h",col:d>0?CN.amberDark:CN.green};}],
                      ["Wages",s=>fmt$(s.grandTotal.wages),(a,b)=>{const d=b.grandTotal.wages-a.grandTotal.wages;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Taxes",s=>fmt$(s.grandTotal.taxes),(a,b)=>{const d=b.grandTotal.taxes-a.grandTotal.taxes;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                      ["Benefits",s=>fmt$(s.grandTotal.benefits),(a,b)=>{const d=b.grandTotal.benefits-a.grandTotal.benefits;return{txt:(d>=0?"+":"")+fmt$(d),col:d>0?CN.red:CN.green};}],
                    ].map(([label,val,diff],ri)=>(
                      <tr key={label} style={{backgroundColor:ri%2===0?CN.white:CN.cream}}>
                        <td style={{...TD,padding:"10px 12px",borderLeft:"none",fontWeight:600,color:CN.mid}}>{label}</td>
                        {compareData.map(s=><td key={s.id} style={{...TD,padding:"10px 12px",textAlign:"right",fontWeight:label==="Total Cost"?700:400,color:CN.dark}}>{val(s)}</td>)}
                        {compareData.length===2&&(()=>{const{txt,col}=diff(compareData[0],compareData[1]);return<td style={{...TD,padding:"10px 12px",textAlign:"right",fontWeight:700,color:col,borderRight:"none"}}>{txt}</td>;})()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <style>{`@media print{body *{visibility:hidden;}.print-table,.print-table *{visibility:visible;}.print-table{position:absolute;left:0;top:0;}}`}</style>
    </div>
  );
}

// ── Tax Tab ───────────────────────────────────────────────────────
function TaxTab({taxYears,setTaxYears,selectedYear,setSelectedYear,ot,setOt,dirty,onSave,onClear,saving,isMobile}){
  const tax=taxYears?.[selectedYear]||defaultTaxForYear(selectedYear);
  const setTax=(fn)=>setTaxYears(prev=>({...prev,[selectedYear]:fn(prev[selectedYear]||defaultTaxForYear(selectedYear))}));
  const allFilled=tax.federalSS&&tax.federalMedicare&&tax.futa&&tax.waSUI&&tax.waLnI&&tax.minWage&&tax.nonExemptWeeklyMin;
  const currentYear=new Date().getFullYear();
  const savedYears=Object.keys(taxYears||{}).map(Number).sort();
  const displayYears=[...new Set([...savedYears,currentYear,currentYear+1])].sort();
  const addYear=(year)=>{if(!taxYears?.[year])setTaxYears(prev=>({...prev,[year]:defaultTaxForYear(year)}));setSelectedYear(year);};
  return(
    <div>
      <PageHeader title="Taxes & Regulations" subtitle="Payroll tax rates and overtime rules. Finalize each year before scheduling."/>
      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <Sub style={{margin:0}}>Tax Year</Sub>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {displayYears.map(y=>(
              <button key={y} onClick={()=>addYear(y)} style={{padding:"6px 18px",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer",border:`2px solid ${selectedYear===y?CN.orange:CN.border}`,backgroundColor:selectedYear===y?CN.orange:CN.white,color:selectedYear===y?CN.white:CN.dark,fontFamily:"'Barlow Semi Condensed',sans-serif"}}>
                {y}{taxYears?.[y]?.finalized&&<span style={{marginLeft:5,fontSize:10}}>✓</span>}
              </button>
            ))}
          </div>
          {!tax.finalized&&<span style={{fontSize:11,color:CN.mid}}>Not finalized</span>}
          {tax.finalized&&<span style={{fontSize:11,color:CN.green,fontWeight:700}}>✓ Finalized</span>}
        </div>
      </Card>
      {!tax.finalized&&<Note type="warning">⚠️ {selectedYear} not finalized. Complete all fields and click <strong>Finalize {selectedYear}</strong>.</Note>}
      {tax.finalized&&<Note type="success">✓ {selectedYear} finalized. Cost calculations active.</Note>}
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
          <Field label="WA Min Wage — Adult ($/hr)" type="number" value={tax.minWage} step={0.01} onChange={v=>setTax(p=>({...p,minWage:v}))} note="lni.wa.gov"/>
          <Field label="WA Min Wage — Minor <16 ($/hr)" type="number" value={tax.minWageMinor||""} placeholder="0 = same as adult" step={0.01} min={0} onChange={v=>setTax(p=>({...p,minWageMinor:v===""?0:v}))} note="lni.wa.gov — WA allows 85% of adult min wage for minors."/>
        </div>
      </Card>
      <Card>
        <Sub>Overtime & Exemption Rules</Sub>
        <Note>WA follows FLSA: OT required after <strong>40 hrs/week at 1.5×</strong> for non-exempt employees.</Note>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:"0 20px",maxWidth:isMobile?"100%":"600px"}}>
          <Field label="Weekly OT Threshold (hrs)" type="number" value={ot.weeklyThreshold} step={1} min={1} onChange={v=>setOt(p=>({...p,weeklyThreshold:v}))}/>
          <Field label="OT Multiplier" type="number" value={ot.multiplier} step={0.1} min={1} onChange={v=>setOt(p=>({...p,multiplier:v}))}/>
          <Field label="Daily Max (soft, hrs)" type="number" value={ot.dailyMax} step={0.5} min={0} onChange={v=>setOt(p=>({...p,dailyMax:v}))} note="0 = disabled"/>
        </div>
        <div style={{maxWidth:isMobile?"100%":"300px"}}>
          <Field label={`WA Non-Exempt Salary Threshold ($/wk) — ${selectedYear}`} type="number" value={tax.nonExemptWeeklyMin||1332.80} step={0.01} min={0} onChange={v=>setTax(p=>({...p,nonExemptWeeklyMin:v}))} note="lni.wa.gov — update each year."/>
        </div>
      </Card>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
        {!tax.finalized&&allFilled&&<Btn onClick={()=>setTax(p=>({...p,finalized:true}))}>✓ Finalize {selectedYear}</Btn>}
        {tax.finalized&&<Btn variant="secondary" onClick={()=>setTax(p=>({...p,finalized:false}))}>Unlock {selectedYear} to Edit</Btn>}
      </div>
      <SaveBar dirty={dirty} onSave={onSave} onClear={onClear} saving={saving} isMobile={isMobile}/>
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}

// ── Admin Tab ─────────────────────────────────────────────────────
function AdminTab({currentUser,allUsers,admins,onPromote,onDemote,onRefresh,isMobile}){
  const[expanded,setExpanded]=useState(null);
  const[userScenarios,setUserScenarios]=useState({});
  const[loadingUser,setLoadingUser]=useState(null);
  const[renaming,setRenaming]=useState(null);
  const[confirmDelete,setConfirmDelete]=useState(null);
  const isAdminFn=id=>admins.includes(id);
  const isSelf=id=>id===currentUser.id;
  const loadUserScenarios=async(userId)=>{
    if(userScenarios[userId]){setExpanded(userId);return;}
    setLoadingUser(userId);
    const sk=userSK(userId);
    const rs=await loadS(sk.roleScenarios,null);
    const ps=await loadS(sk.planScenarios,null);
    setUserScenarios(prev=>({...prev,[userId]:{rs,ps}}));
    setExpanded(userId);setLoadingUser(null);
  };
  const handleDelete=async()=>{
    if(!confirmDelete)return;
    const{userId,type,scenarioId}=confirmDelete;
    const sk=userSK(userId);const key=type==='role'?sk.roleScenarios:sk.planScenarios;
    const current=userScenarios[userId];const field=type==='role'?'rs':'ps';const data=current[field];
    if(!data)return;
    const updated={...data,scenarios:data.scenarios.filter(s=>s.id!==scenarioId)};
    if(updated.activeId===scenarioId)updated.activeId=updated.scenarios[0]?.id||null;
    await saveS(key,updated);
    setUserScenarios(prev=>({...prev,[userId]:{...prev[userId],[field]:updated}}));
    setConfirmDelete(null);
  };
  const handleRename=async()=>{
    if(!renaming||!renaming.name.trim())return;
    const{userId,type,scenarioId,name}=renaming;
    const sk=userSK(userId);const key=type==='role'?sk.roleScenarios:sk.planScenarios;const field=type==='role'?'rs':'ps';
    const data=userScenarios[userId]?.[field];if(!data)return;
    const updated={...data,scenarios:data.scenarios.map(s=>s.id===scenarioId?{...s,name:name.trim()}:s)};
    await saveS(key,updated);
    setUserScenarios(prev=>({...prev,[userId]:{...prev[userId],[field]:updated}}));
    setRenaming(null);
  };
  const ScenarioList=({userId,type,scenarios})=>{
    const label=type==='role'?'Role':'Schedule';const icon=type==='role'?'👥':'📋';
    if(!scenarios?.length)return<div style={{fontSize:12,color:CN.mid,padding:'6px 0'}}>No {label.toLowerCase()} scenarios</div>;
    return(
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:CN.mid,marginBottom:6}}>{icon} {label} Scenarios</div>
        {scenarios.map(s=>(
          <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',backgroundColor:CN.creamDark,borderRadius:8,marginBottom:4}}>
            {renaming?.userId===userId&&renaming?.type===type&&renaming?.scenarioId===s.id
              ?<div style={{display:'flex',gap:6,flex:1}}><input autoFocus value={renaming.name} onChange={e=>setRenaming(r=>({...r,name:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')handleRename();if(e.key==='Escape')setRenaming(null);}} style={{...baseInp,fontSize:12,padding:'4px 8px',flex:1}}/><button onClick={handleRename} style={{fontSize:11,padding:'4px 8px',backgroundColor:CN.orange,color:CN.white,border:'none',borderRadius:6,cursor:'pointer',fontWeight:700}}>Save</button><button onClick={()=>setRenaming(null)} style={{fontSize:11,padding:'4px 8px',backgroundColor:CN.creamDark,color:CN.mid,border:`1px solid ${CN.border}`,borderRadius:6,cursor:'pointer'}}>×</button></div>
              :<><span style={{flex:1,fontSize:13,color:CN.dark,fontWeight:500}}>{s.name}</span><span style={{fontSize:11,color:CN.mid}}>{type==='role'?`${s.roles?.length||0} roles`:`${[...new Set(s.plans?.map(p=>p.weekOf)||[])].length} weeks`}</span><button onClick={()=>setRenaming({userId,type,scenarioId:s.id,name:s.name})} style={{fontSize:11,padding:'3px 8px',backgroundColor:CN.white,border:`1px solid ${CN.border}`,borderRadius:6,cursor:'pointer',color:CN.mid}}>Rename</button><button onClick={()=>setConfirmDelete({userId,type,scenarioId:s.id,name:s.name})} style={{fontSize:11,padding:'3px 8px',backgroundColor:CN.white,border:`1px solid ${CN.red}`,borderRadius:6,cursor:'pointer',color:CN.red}}>Delete</button></>
            }
          </div>
        ))}
      </div>
    );
  };
  return(
    <div>
      <PageHeader title="Admin Panel" subtitle={`${allUsers.length} user${allUsers.length!==1?"s":""} · Manage scenarios and permissions`} actions={<Btn variant="secondary" onClick={onRefresh}>↻ Refresh</Btn>}/>
      {allUsers.length===0&&<Note>No users have signed in yet.</Note>}
      {allUsers.map(u=>{
        const isExpanded=expanded===u.id;const uScenarios=userScenarios[u.id];const loading=loadingUser===u.id;const uIsAdmin=isAdminFn(u.id);const uIsSelf=isSelf(u.id);
        return(
          <Card key={u.id} style={{marginBottom:12,border:uIsSelf?`2px solid ${CN.orange}`:`1.5px solid ${CN.border}`}}>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              {u.avatar?<img src={u.avatar} alt={u.name} style={{width:40,height:40,borderRadius:'50%',objectFit:'cover',flexShrink:0}}/>:<div style={{width:40,height:40,borderRadius:'50%',backgroundColor:CN.orange,display:'flex',alignItems:'center',justifyContent:'center',color:CN.white,fontWeight:700,fontSize:16,flexShrink:0}}>{(u.name?.[0]||'?').toUpperCase()}</div>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontWeight:700,fontSize:14,color:CN.dark}}>{u.name}</span>
                  {uIsSelf&&<span style={{fontSize:10,fontWeight:700,backgroundColor:CN.orangeLight,color:CN.orange,padding:'1px 7px',borderRadius:99}}>You</span>}
                  {uIsAdmin&&<span style={{fontSize:10,fontWeight:700,backgroundColor:CN.purpleLight,color:CN.purple,padding:'1px 7px',borderRadius:99}}>Admin</span>}
                </div>
                <div style={{fontSize:12,color:CN.mid}}>{u.email}</div>
                {u.lastSeen&&<div style={{fontSize:11,color:CN.mid}}>Last seen: {new Date(u.lastSeen).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>}
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
                {!uIsSelf&&(uIsAdmin?<Btn variant="secondary" onClick={()=>onDemote(u.id)} style={{fontSize:11,padding:'5px 12px'}}>Remove Admin</Btn>:<Btn variant="secondary" onClick={()=>onPromote(u.id)} style={{fontSize:11,padding:'5px 12px'}}>Make Admin</Btn>)}
                <Btn variant="secondary" onClick={()=>isExpanded?setExpanded(null):loadUserScenarios(u.id)} style={{fontSize:11,padding:'5px 12px'}}>{loading?'Loading…':isExpanded?'Hide':'View Scenarios'}</Btn>
              </div>
            </div>
            {isExpanded&&(
              <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${CN.border}`}}>
                {!uScenarios&&<div style={{color:CN.mid,fontSize:13}}>No data found.</div>}
                {uScenarios&&<><ScenarioList userId={u.id} type="role" scenarios={uScenarios.rs?.scenarios}/><ScenarioList userId={u.id} type="plan" scenarios={uScenarios.ps?.scenarios}/></>}
              </div>
            )}
          </Card>
        );
      })}
      <ConfirmDialog
        open={!!confirmDelete} onOpenChange={v=>!v&&setConfirmDelete(null)}
        icon="🗑" title="Delete Scenario"
        description={<>Permanently delete <strong>"{confirmDelete?.name}"</strong>? Cannot be undone.</>}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        destructive
      />
    </div>
  );
}

// ── Forecaster ────────────────────────────────────────────────────
const FORECAST_BENCHMARKS={
  "line cook":{revenuePerHr:120,coversPerHr:15,floor:1,source:"NRA Industry Operations Report 2023",sourceUrl:"https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/"},
  "prep":{revenuePerHr:200,coversPerHr:25,floor:1,source:"NRA Industry Operations Report 2023",sourceUrl:"https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/"},
  "dishwasher":{revenuePerHr:250,coversPerHr:30,floor:1,source:"NRA Industry Operations Report 2023",sourceUrl:"https://restaurant.org/research-and-media/research/economists-notebook/analysis-commentary/independent-restaurant-performance-report/"},
  "server":{revenuePerHr:80,coversPerHr:12,floor:1,source:"Cornell Hospitality Quarterly",sourceUrl:"https://journals.sagepub.com/home/cqx"},
  "foh":{revenuePerHr:80,coversPerHr:12,floor:1,source:"Cornell Hospitality Quarterly",sourceUrl:"https://journals.sagepub.com/home/cqx"},
  "cashier":{revenuePerHr:150,coversPerHr:20,floor:1,source:"7shifts Restaurant Labor Benchmark Report 2023",sourceUrl:"https://www.7shifts.com/blog/restaurant-labor-cost/"},
  "counter":{revenuePerHr:150,coversPerHr:20,floor:1,source:"7shifts Restaurant Labor Benchmark Report 2023",sourceUrl:"https://www.7shifts.com/blog/restaurant-labor-cost/"},
  "delivery":{revenuePerHr:180,coversPerHr:22,floor:0,source:"7shifts Restaurant Labor Benchmark Report 2023",sourceUrl:"https://www.7shifts.com/blog/restaurant-labor-cost/"},
  "manager":{revenuePerHr:null,coversPerHr:null,floor:1,source:"Fixed floor — managerial coverage standard",sourceUrl:"https://restaurant.org/"},
  "default":{revenuePerHr:150,coversPerHr:18,floor:1,source:"NRA Industry Operations Report 2023 (general)",sourceUrl:"https://restaurant.org/"},
};
const DAY_TYPE_MULTIPLIERS={Slow:0.7,Normal:1.0,Busy:1.3,Event:1.5};
const BREAK_RULES={paidRestPer4hrs:10,mealBreakAt5hrs:30};
function getBenchmark(roleName){const lower=(roleName||"").toLowerCase();for(const[key,val]of Object.entries(FORECAST_BENCHMARKS)){if(key!=="default"&&lower.includes(key))return{...val};}return{...FORECAST_BENCHMARKS.default};}
function calcBreakMinutes(shiftHrs,mealPaid){const restBreaks=Math.floor(shiftHrs/4)*BREAK_RULES.paidRestPer4hrs;const mealBreak=shiftHrs>=5?(mealPaid?BREAK_RULES.mealBreakAt5hrs:0):0;return restBreaks+mealBreak;}
function calcOperatingHrs(openTime,closeTime){if(!openTime||!closeTime)return 0;const[oh,om]=openTime.split(":").map(Number);const[ch,cm]=closeTime.split(":").map(Number);const mins=(ch*60+cm)-(oh*60+om);return Math.max(0,mins/60);}
function runRuleEngine(inputs,hourlyRoles,assumptions,mealBreakPaid){
  const results={};
  hourlyRoles.forEach(role=>{
    const bench=assumptions[role.id]||getBenchmark(role.name);let totalNeededHrs=0;const hoursPerDay={};
    DAYS.forEach(day=>{
      const d=inputs.days[day]||{};if(d.closed){hoursPerDay[day]=0;return;}
      const opHrs=calcOperatingHrs(d.open,d.close);const multiplier=DAY_TYPE_MULTIPLIERS[d.dayType||"Normal"];
      let hrsFromRevenue=0,hrsFromCovers=0,hrsFromDirect=0;
      const floorHrs=bench.floor>0?opHrs:0;
      if(d.revenue&&bench.revenuePerHr)hrsFromRevenue=(Number(d.revenue)*multiplier)/bench.revenuePerHr;
      if(d.covers&&bench.coversPerHr)hrsFromCovers=(Number(d.covers)*multiplier)/bench.coversPerHr;
      if(d.directHrs)hrsFromDirect=Number(d.directHrs);
      const volumeHrs=Math.max(hrsFromRevenue,hrsFromCovers,hrsFromDirect);
      const rawHrs=Math.max(floorHrs,volumeHrs);
      const breakMins=rawHrs>0?calcBreakMinutes(rawHrs,mealBreakPaid):0;
      const totalHrs=rawHrs+breakMins/60;
      hoursPerDay[day]=Math.round(totalHrs*2)/2;totalNeededHrs+=hoursPerDay[day];
    });
    const defaultShift=role.defaultHours||35;const headcount=Math.max(bench.floor,Math.ceil(totalNeededHrs/defaultShift));
    results[role.id]={totalHrs:totalNeededHrs,headcount,hoursPerDay};
  });
  return results;
}
function distributeEvenly(totalHrs,operatingDays){if(!operatingDays.length)return{};const perDay=Math.round((totalHrs/operatingDays.length)*2)/2;return Object.fromEntries(DAYS.map(d=>[d,operatingDays.includes(d)?perDay:0]));}
function distributeWeighted(totalHrs,inputs){
  const weights={mon:1.0,tue:1.0,wed:1.0,thu:1.0,fri:1.2,sat:1.4,sun:1.4};
  const operatingDays=DAYS.filter(d=>!(inputs.days[d]?.closed));
  const totalWeight=operatingDays.reduce((s,d)=>s+(weights[d]||1.0),0);
  return Object.fromEntries(DAYS.map(d=>{if(inputs.days[d]?.closed||!operatingDays.includes(d))return[d,0];return[d,Math.round((totalHrs*(weights[d]/totalWeight))*2)/2];}));
}
function ForecasterTab({roleScenarios,setRoleScenarios,planScenarios,setPlanScenarios,taxYears,ot,isMobile,onAccepted}){
  const currentYear=new Date().getFullYear();
  const tax=taxYears?.[currentYear]||DEFAULT_TAX;
  const activeRS=roleScenarios?.scenarios?.find(s=>s.id===roleScenarios.activeId);
  const[localRoles,setLocalRoles]=useState(()=>(activeRS?.roles||[]).filter(r=>r.active&&r.payType==="Hourly"));
  const[weekOf,setWeekOf]=useState(()=>{const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));return isoMonday(d);});
  const defaultDayInputs=()=>DAYS.reduce((a,d)=>({...a,[d]:{open:"11:00",close:"21:00",dayType:"Normal",revenue:"",covers:"",directHrs:"",closed:d==="mon"}}),{});
  const[dayInputs,setDayInputs]=useState(defaultDayInputs);
  const setDay=(day,field,val)=>setDayInputs(p=>({...p,[day]:{...p[day],[field]:val}}));
  const[inputMode,setInputMode]=useState("revenue");
  const[mealBreakPaid,setMealBreakPaid]=useState(true);
  const[assumptions,setAssumptions]=useState(()=>Object.fromEntries((activeRS?.roles||[]).filter(r=>r.active&&r.payType==="Hourly").map(r=>[r.id,getBenchmark(r.name)])));
  const setAssumption=(roleId,field,val)=>setAssumptions(p=>({...p,[roleId]:{...p[roleId],[field]:isNaN(Number(val))?val:Number(val)}}));
  const[results,setResults]=useState(null);
  const[claudeNarrative,setClaudeNarrative]=useState("");
  const[claudeDistribution,setClaudeDistribution]=useState(null);
  const[running,setRunning]=useState(false);
  const[runError,setRunError]=useState("");
  const[distMode,setDistMode]=useState("claude");
  const[outputFormat,setOutputFormat]=useState("skeleton");
  const[gaps,setGaps]=useState([]);
  const[addingGap,setAddingGap]=useState(null);
  const[gapForm,setGapForm]=useState({name:"",category:"BOH",rate:"",defaultHours:35,otEligible:true,isMinor:false});
  const[accepted,setAccepted]=useState(false);
  const[acceptedScenarios,setAcceptedScenarios]=useState(null);
  const[currentStep,setCurrentStep]=useState(1);
  const TOTAL_STEPS=5;

  useEffect(()=>{
    const rs=roleScenarios?.scenarios?.find(s=>s.id===roleScenarios.activeId);
    const hourly=(rs?.roles||[]).filter(r=>r.active&&r.payType==="Hourly");
    setLocalRoles(hourly);setAssumptions(Object.fromEntries(hourly.map(r=>[r.id,getBenchmark(r.name)])));
  },[roleScenarios]);

  const operatingDays=DAYS.filter(d=>!dayInputs[d]?.closed);

  async function runForecast(){
    setRunning(true);setRunError("");setClaudeNarrative("");setClaudeDistribution(null);setResults(null);setGaps([]);
    try{
      const ruleResults=runRuleEngine({days:dayInputs},localRoles,assumptions,mealBreakPaid);
      setResults(ruleResults);
      const weekSummary=DAYS.map(d=>{const di=dayInputs[d];if(di.closed)return`${DAY_LABELS[DAYS.indexOf(d)]}: Closed`;const opHrs=calcOperatingHrs(di.open,di.close).toFixed(1);const parts=[`${di.open}–${di.close} (${opHrs}h)`,`${di.dayType}`];if(di.revenue)parts.push(`$${di.revenue} rev`);if(di.covers)parts.push(`${di.covers} covers`);return`${DAY_LABELS[DAYS.indexOf(d)]}: ${parts.join(", ")}`;}).join("\n");
      const roleSummary=localRoles.map(r=>{const b=assumptions[r.id];const res=ruleResults[r.id];return`- ${r.name} (${r.category}): ${res?.totalHrs.toFixed(1)}h needed, ${res?.headcount} people, rate $${r.rate}/hr. Benchmarks: $${b.revenuePerHr}/rev-hr, ${b.coversPerHr} covers/hr, floor ${b.floor}.`;}).join("\n");
      const prompt=`You are a restaurant operations analyst. Analyze this staffing plan for Cheeky Noodles and provide:
1. A brief narrative (3–5 sentences) explaining the staffing recommendation and any notable observations.
2. A JSON block (fenced with \`\`\`json) with day-by-day hour distribution per role ID. Keys are role IDs, values are objects with day keys (mon/tue/wed/thu/fri/sat/sun) and hour values (number, rounded to 0.5).

Week: ${fmtWeek(weekOf)}
Operating schedule:
${weekSummary}

Hourly roles and rule-engine output:
${roleSummary}

Meal breaks: ${mealBreakPaid?"paid (included in hours)":"unpaid (not in hours)"}
Input mode: ${inputMode}

Distribute hours thoughtfully across operating days, weighting heavier days appropriately. Keep total hours per role close to the rule-engine totals. Return ONLY the narrative then the JSON block.`;
      const token=await window._clerkGetToken();
      if(!token)throw new Error("Session expired — please refresh and sign in again.");
      const response=await fetch("https://cheeky-headcount-proxy.vaughan-184.workers.dev/forecast",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,messages:[{role:"user",content:prompt}]})});
      if(!response.ok){const errText=await response.text();let errMsg=`Anthropic returned ${response.status}`;try{const errJson=JSON.parse(errText);errMsg=errJson?.error?.message||errJson?.error||errMsg;}catch{}throw new Error(errMsg);}
      const data=await response.json();
      const text=data.content?.map(b=>b.text||"").join("")||"";
      const jsonMatch=text.match(/```json\s*([\s\S]*?)```/);let dist=null;if(jsonMatch){try{dist=JSON.parse(jsonMatch[1]);}catch{}}
      const narrative=text.replace(/```json[\s\S]*?```/,"").trim();
      setClaudeNarrative(narrative);if(dist)setClaudeDistribution(dist);
    }catch(e){setRunError("Forecast failed: "+e.message);return false;}finally{setRunning(false);}
  }

  function getDistribution(roleId){
    if(distMode==="claude"&&claudeDistribution?.[roleId])return claudeDistribution[roleId];
    const totalHrs=results?.[roleId]?.totalHrs||0;
    if(distMode==="even")return distributeEvenly(totalHrs,operatingDays);
    return distributeWeighted(totalHrs,{days:dayInputs});
  }

  function calcForecastCost(roleId){
    const role=localRoles.find(r=>r.id===roleId);if(!role||!results?.[roleId])return null;
    const dist=getDistribution(roleId);return calcRowCost(role,dist,tax,ot);
  }

  const totalCost=results?localRoles.reduce((s,r)=>{const c=calcForecastCost(r.id);return s+(c?.total||0);},0):0;

  function commitGapRole(){
    if(!gapForm.name||!gapForm.rate)return;
    const newRole={id:uid(),name:gapForm.name,category:gapForm.category,payType:"Hourly",rate:Number(gapForm.rate),defaultHours:Number(gapForm.defaultHours)||35,otEligible:gapForm.otEligible,exempt:false,isMinor:gapForm.isMinor,benefits:{...DEFAULT_BENEFITS},active:true};
    setRoleScenarios(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===prev.activeId?{...s,roles:[...s.roles,newRole]}:s)}));
    setLocalRoles(p=>[...p,newRole]);setAssumptions(p=>({...p,[newRole.id]:getBenchmark(newRole.name)}));
    setGaps(p=>p.filter(g=>g!==addingGap));setAddingGap(null);setGapForm({name:"",category:"BOH",rate:"",defaultHours:35,otEligible:true,isMinor:false});
  }

  function acceptForecast(){
    if(!results)return;
    const label=`Forecast — ${fmtWeek(weekOf)}`;
    const newRS=makeRoleScenario(label,localRoles);
    const updatedRS={...roleScenarios,scenarios:[...roleScenarios.scenarios,newRS]};
    const newPS=makePlanScenario(label,newRS.id);
    const plans=[];
    localRoles.forEach(role=>{
      const dist=getDistribution(role.id);const headcount=results[role.id]?.headcount||1;
      for(let i=0;i<headcount;i++){const days={};DAYS.forEach(d=>{const dayTotal=dist[d]||0;days[d]=Math.round((dayTotal/headcount)*2)/2;});plans.push({id:uid(),weekOf,roleId:role.id,days});}
    });
    newPS.plans=plans;
    const updatedPS={...planScenarios,scenarios:[...planScenarios.scenarios,newPS],activeId:newPS.id};
    setRoleScenarios(updatedRS);setPlanScenarios(updatedPS);setAccepted(true);setAcceptedScenarios({roleName:newRS.name,planName:newPS.name});
    if(onAccepted)onAccepted();
  }

  const STEP_LABELS=["Week Setup","Volume Inputs","Assumptions","Results","Accept"];
  const inputStyle={border:`1.5px solid ${CN.border}`,borderRadius:8,padding:"7px 10px",fontSize:13,fontFamily:"'Barlow Semi Condensed',sans-serif",color:CN.dark,backgroundColor:CN.white,outline:"none",width:"100%",boxSizing:"border-box"};
  const sectionLabel={fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,marginBottom:8,display:"block"};
  const pillBtn=(active,onClick,label)=>(
    <button onClick={onClick} style={{padding:"5px 13px",borderRadius:99,border:`1.5px solid ${active?CN.orange:CN.border}`,backgroundColor:active?CN.orangeLight:CN.white,color:active?CN.orange:CN.mid,fontFamily:"'Barlow Semi Condensed',sans-serif",fontSize:12,fontWeight:active?700:400,cursor:"pointer",transition:"all 0.15s"}}>{label}</button>
  );

  const StepNav=()=>(
    <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:28,overflowX:"auto",paddingBottom:4}}>
      {STEP_LABELS.map((label,i)=>{
        const step=i+1;const active=step===currentStep;const done=step<currentStep;const locked=step>=4&&!results;
        return(
          <div key={step} style={{display:"flex",alignItems:"center",flexShrink:0}}>
            <button onClick={()=>!locked&&setCurrentStep(step)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:99,backgroundColor:active?CN.orange:done?CN.creamDark:"transparent",border:`1.5px solid ${active?CN.orange:done?CN.border:CN.border}`,color:active?CN.white:locked?CN.border:CN.mid,cursor:locked?"not-allowed":"pointer",fontSize:12,fontWeight:active?700:400,fontFamily:"'Barlow Semi Condensed',sans-serif",whiteSpace:"nowrap",transition:"all 0.2s"}}>
              <span style={{width:18,height:18,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,backgroundColor:active?"rgba(255,255,255,0.25)":done?CN.orange:CN.border,color:active?CN.white:done?CN.white:CN.mid,flexShrink:0}}>{done&&step<currentStep?"✓":step}</span>
              {!isMobile&&label}
            </button>
            {i<STEP_LABELS.length-1&&<div style={{width:24,height:1.5,backgroundColor:step<currentStep?CN.orange:CN.border,flexShrink:0}}/>}
          </div>
        );
      })}
    </div>
  );

  const NavBar=({nextLabel,nextDisabled,onNext})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:28,paddingTop:20,borderTop:`1px solid ${CN.border}`}}>
      <button onClick={()=>currentStep>1&&setCurrentStep(s=>s-1)} style={{padding:"9px 18px",borderRadius:10,border:`1.5px solid ${CN.border}`,backgroundColor:CN.white,color:currentStep===1?CN.border:CN.mid,cursor:currentStep===1?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"'Barlow Semi Condensed',sans-serif"}} disabled={currentStep===1}>← Back</button>
      {currentStep<TOTAL_STEPS&&<button onClick={onNext||(()=>setCurrentStep(s=>s+1))} disabled={nextDisabled} style={{padding:"9px 22px",borderRadius:10,border:"none",backgroundColor:nextDisabled?CN.border:CN.orange,color:CN.white,cursor:nextDisabled?"not-allowed":"pointer",fontSize:13,fontWeight:700,fontFamily:"'Bowlby One SC',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em",transition:"all 0.15s"}}>{nextLabel||"Next →"}</button>}
    </div>
  );

  return(
    <div>
      <PageHeader
        title="Headcount Forecaster"
        subtitle="Driver-based staffing plan — rule engine + Claude analysis"
        actions={
          (results||runError||currentStep>1)&&(
            <button onClick={()=>{setCurrentStep(1);setResults(null);setClaudeNarrative("");setClaudeDistribution(null);setRunError("");setGaps([]);setAccepted(false);setAcceptedScenarios(null);setDayInputs(defaultDayInputs());setDistMode("claude");}} style={{padding:"7px 14px",borderRadius:8,border:`1.5px solid ${CN.border}`,backgroundColor:CN.white,color:CN.mid,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Barlow Semi Condensed',sans-serif"}}>↺ Reset</button>
          )
        }
      />
      <StepNav/>
      {accepted&&acceptedScenarios&&<Note type="success">✅ Forecast accepted. Created <strong>"{acceptedScenarios.planName}"</strong> — switch to Schedule to review and edit.</Note>}

      {/* Step 1 */}
      {currentStep===1&&(
        <Card>
          <Sub>Step 1 — Week Setup</Sub>
          <div style={{display:"flex",flexWrap:"wrap",gap:16,marginBottom:20}}>
            <div style={{flex:"1 1 180px"}}>
              <span style={sectionLabel}>Week of</span>
              <input type="date" value={weekOf} onChange={e=>setWeekOf(e.target.value)} style={{...inputStyle,width:"auto"}}/>
            </div>
            <div style={{flex:"1 1 220px"}}>
              <span style={sectionLabel}>Meal break treatment</span>
              <div style={{display:"flex",gap:8}}>
                {pillBtn(mealBreakPaid,()=>setMealBreakPaid(true),"Paid (include in hours)")}
                {pillBtn(!mealBreakPaid,()=>setMealBreakPaid(false),"Unpaid (exclude)")}
              </div>
              <div style={{fontSize:11,color:CN.mid,marginTop:4}}>10-min paid rests per 4h always included · WA RCW 49.12.187</div>
            </div>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:560}}>
              <thead><tr style={{backgroundColor:CN.creamDark}}>
                {["Day","Closed","Open","Close","Day Type","Op Hrs"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Closed"?"center":"left",fontWeight:700,color:CN.mid,fontSize:11,whiteSpace:"nowrap"}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {DAYS.map((d,i)=>{const di=dayInputs[d];const opHrs=di.closed?0:calcOperatingHrs(di.open,di.close);return(
                  <tr key={d} style={{backgroundColor:i%2===0?CN.white:CN.cream,opacity:di.closed?0.5:1}}>
                    <td style={{padding:"7px 10px",fontWeight:600,color:CN.dark}}>{DAY_LABELS[i]}</td>
                    <td style={{padding:"7px 10px",textAlign:"center"}}><input type="checkbox" checked={!!di.closed} onChange={e=>setDay(d,"closed",e.target.checked)} style={{accentColor:CN.orange,width:15,height:15}}/></td>
                    <td style={{padding:"4px 8px"}}><input type="time" value={di.open} disabled={di.closed} onChange={e=>setDay(d,"open",e.target.value)} style={{...inputStyle,width:100,opacity:di.closed?0.4:1}}/></td>
                    <td style={{padding:"4px 8px"}}><input type="time" value={di.close} disabled={di.closed} onChange={e=>setDay(d,"close",e.target.value)} style={{...inputStyle,width:100,opacity:di.closed?0.4:1}}/></td>
                    <td style={{padding:"4px 8px"}}><select value={di.dayType} disabled={di.closed} onChange={e=>setDay(d,"dayType",e.target.value)} style={{...inputStyle,width:110,opacity:di.closed?0.4:1}}>{Object.keys(DAY_TYPE_MULTIPLIERS).map(t=><option key={t} value={t}>{t} ({DAY_TYPE_MULTIPLIERS[t]}×)</option>)}</select></td>
                    <td style={{padding:"7px 8px",fontWeight:700,color:opHrs>0?CN.dark:CN.mid,fontSize:13}}>{opHrs>0?opHrs.toFixed(1)+"h":"—"}</td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          <NavBar/>
        </Card>
      )}

      {/* Step 2 */}
      {currentStep===2&&(
        <Card>
          <Sub>Step 2 — Volume Inputs</Sub>
          <div style={{marginBottom:16}}>
            <span style={sectionLabel}>Forecasting basis</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {[["revenue","💰 Revenue target"],["covers","👥 Cover / transaction count"],["direct","⏱ Direct labor hours"],["oponly","🕐 Operating hours only (floor)"]].map(([mode,label])=>pillBtn(inputMode===mode,()=>setInputMode(mode),label))}
            </div>
            {inputMode==="oponly"&&<div style={{fontSize:12,color:CN.mid,marginTop:8}}>Floor-only mode: staffing based purely on hours of operation.</div>}
          </div>
          {inputMode!=="oponly"&&(
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:400}}>
                <thead><tr style={{backgroundColor:CN.creamDark}}><th style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:CN.mid,fontSize:11}}>Day</th><th style={{padding:"7px 10px",fontWeight:700,color:CN.mid,fontSize:11}}>{inputMode==="revenue"?"Revenue ($)":inputMode==="covers"?"Covers":"Labor Hours"}</th></tr></thead>
                <tbody>
                  {DAYS.map((d,i)=>{const di=dayInputs[d];if(di.closed)return null;return(
                    <tr key={d} style={{backgroundColor:i%2===0?CN.white:CN.cream}}>
                      <td style={{padding:"6px 10px",fontWeight:600,color:CN.dark}}>{DAY_LABELS[i]}</td>
                      <td style={{padding:"4px 8px"}}><input type="number" min={0} value={inputMode==="revenue"?di.revenue:inputMode==="covers"?di.covers:di.directHrs} placeholder={inputMode==="revenue"?"e.g. 2500":inputMode==="covers"?"e.g. 80":"e.g. 40"} step={inputMode==="direct"?0.5:1} onChange={e=>setDay(d,inputMode==="revenue"?"revenue":inputMode==="covers"?"covers":"directHrs",e.target.value)} style={{...inputStyle,width:150}}/></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
          <NavBar/>
        </Card>
      )}

      {/* Step 3 */}
      {currentStep===3&&(
        <Card>
          <Sub>Step 3 — Productivity Assumptions</Sub>
          <Note type="info">These are planning benchmarks — edit to match your operation before running.</Note>
          {localRoles.length===0&&<Note type="warning">No active hourly roles found. Add roles in Job Roles first.</Note>}
          {localRoles.length>0&&(
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:520}}>
                <thead><tr style={{backgroundColor:CN.creamDark}}>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:CN.mid,fontSize:11}}>Role</th>
                  <th style={{padding:"8px 10px",fontWeight:700,color:CN.mid,fontSize:11}}>Rev/hr ($)<RTip source={getBenchmark("default").source} url={getBenchmark("default").sourceUrl}/></th>
                  <th style={{padding:"8px 10px",fontWeight:700,color:CN.mid,fontSize:11}}>Covers/hr<RTip source="Cornell Hospitality Quarterly" url="https://journals.sagepub.com/home/cqx"/></th>
                  <th style={{padding:"8px 10px",fontWeight:700,color:CN.mid,fontSize:11}}>Floor<RTip source="Min coverage — 1 person must be present when open" url="https://restaurant.org/"/></th>
                </tr></thead>
                <tbody>
                  {localRoles.map((r,i)=>{const a=assumptions[r.id]||getBenchmark(r.name);const bench=getBenchmark(r.name);return(
                    <tr key={r.id} style={{backgroundColor:i%2===0?CN.white:CN.cream}}>
                      <td style={{padding:"7px 10px"}}><div style={{fontWeight:600,color:CN.dark}}>{r.name}</div><div style={{fontSize:10,color:CN.mid}}>{r.category} · ${r.rate}/hr</div></td>
                      <td style={{padding:"4px 8px"}}><div style={{display:"flex",alignItems:"center",gap:4}}><input type="number" min={0} value={a.revenuePerHr??""} placeholder="n/a" onChange={e=>setAssumption(r.id,"revenuePerHr",e.target.value===""?null:e.target.value)} style={{...inputStyle,width:80}}/><RTip source={bench.source} url={bench.sourceUrl}/></div></td>
                      <td style={{padding:"4px 8px"}}><div style={{display:"flex",alignItems:"center",gap:4}}><input type="number" min={0} value={a.coversPerHr??""} placeholder="n/a" onChange={e=>setAssumption(r.id,"coversPerHr",e.target.value===""?null:e.target.value)} style={{...inputStyle,width:80}}/><RTip source={bench.source} url={bench.sourceUrl}/></div></td>
                      <td style={{padding:"4px 8px"}}><input type="number" min={0} max={5} value={a.floor} onChange={e=>setAssumption(r.id,"floor",e.target.value)} style={{...inputStyle,width:60}}/></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
          {runError&&<Note type="alert" style={{marginTop:12}}>{runError}</Note>}
          <NavBar
            nextLabel={running?"⟳ Running…":(results&&!runError)?"View Results →":"▶ Run Forecast"}
            nextDisabled={running||localRoles.length===0}
            onNext={()=>{
              if(results&&!runError){setCurrentStep(4);return;}
              setRunError("");
              runForecast().then(ok=>{if(ok!==false)setCurrentStep(4);});
            }}
          />
        </Card>
      )}

      {/* Step 4 */}
      {currentStep===4&&(
        <div>
          {claudeNarrative&&(
            <Card style={{marginBottom:16,borderLeft:`4px solid ${CN.orange}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:18}}>🤖</span>
                <Sub style={{margin:0}}>Claude Analysis</Sub>
              </div>
              <div style={{fontSize:13,color:CN.dark,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{claudeNarrative}</div>
            </Card>
          )}
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
              <Sub style={{margin:0}}>Forecast Results</Sub>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:11,color:CN.mid}}>Distribution:</span>
                {(claudeDistribution?[["claude","🤖 Claude"],["even","⚖ Even"],["weighted","📅 Weighted"]]:
                  [["even","⚖ Even"],["weighted","📅 Weighted"]]).map(([m,l])=>pillBtn(distMode===m,()=>setDistMode(m),l))}
              </div>
            </div>

            {localRoles.map((role,ri)=>{
              const res=results?.[role.id];if(!res)return null;
              const dist=getDistribution(role.id);const cost=calcForecastCost(role.id);
              return(
                <div key={role.id} style={{marginBottom:14,border:`1.5px solid ${CN.border}`,borderRadius:12,overflow:"hidden",transition:"all 0.2s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",backgroundColor:CN.creamDark,flexWrap:"wrap",gap:8}}>
                    <div><span style={{fontWeight:700,fontSize:14,color:CN.dark}}>{role.name}</span><span style={{fontSize:11,color:CN.mid,marginLeft:8}}>{role.category} · ${role.rate}/hr</span></div>
                    <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                      {[
                        {label:"People",value:res.headcount,color:CN.orange,large:true},
                        {label:"Total Hrs",value:res.totalHrs.toFixed(1)+"h",color:CN.dark,large:false},
                        cost?{label:"Week Cost",value:fmt$(cost.total),color:CN.blue,large:false}:null,
                      ].filter(Boolean).map(({label,value,color,large})=>(
                        <div key={label} style={{textAlign:"right"}}>
                          <div style={{fontSize:10,color:CN.mid,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>
                          <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:large?24:17,fontWeight:800,color}}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex"}}>
                    {DAYS.map((d,i)=>{const hrs=dist[d]||0;const closed=dayInputs[d]?.closed;const maxHrs=Math.max(...DAYS.map(dd=>dist[dd]||0),1);const barH=closed?0:Math.round((hrs/maxHrs)*100);return(
                      <div key={d} style={{flex:1,padding:"10px 4px",textAlign:"center",backgroundColor:closed?CN.creamDark:CN.white,borderRight:i<6?`1px solid ${CN.border}`:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                        <div style={{width:"100%",height:32,display:"flex",alignItems:"flex-end",justifyContent:"center",paddingBottom:2}}>
                          {!closed&&hrs>0&&<div style={{width:"70%",height:`${Math.max(barH,8)}%`,backgroundColor:CN.orange,borderRadius:"3px 3px 0 0",minHeight:4,transition:"height 0.3s"}}/>}
                        </div>
                        <div style={{fontSize:10,color:CN.mid,fontWeight:600}}>{DAY_LABELS[i]}</div>
                        <div style={{fontSize:13,fontWeight:700,color:closed?CN.border:hrs>0?CN.dark:CN.mid}}>{closed?"—":hrs>0?hrs+"h":"0h"}</div>
                      </div>
                    );})}
                  </div>
                  {cost&&(
                    <div style={{display:"flex",gap:16,padding:"8px 16px",backgroundColor:CN.cream,fontSize:11,color:CN.mid,flexWrap:"wrap",borderTop:`1px solid ${CN.border}`}}>
                      <span>Wages: <strong style={{color:CN.dark}}>{fmt$(cost.wages)}</strong></span>
                      <span>Taxes: <strong style={{color:CN.dark}}>{fmt$(cost.taxes)}</strong></span>
                      <span>Benefits: <strong style={{color:CN.dark}}>{fmt$(cost.benefits)}</strong></span>
                      {cost.otHrs>0&&<span style={{color:CN.amberDark,fontWeight:700}}>⚡ OT: {cost.otHrs.toFixed(1)}h (+{fmt$(cost.otPremium)})</span>}
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{display:"flex",justifyContent:"flex-end",padding:"14px 18px",background:`linear-gradient(135deg,${CN.dark} 0%,#2A2A26 100%)`,borderRadius:10,marginTop:8}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Total Forecast Labor Cost</div>
                <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontSize:28,fontWeight:800,color:CN.white}}>{fmt$(totalCost)}</div>
              </div>
            </div>

            <NavBar/>
          </Card>
        </div>
      )}

      {/* Step 5 */}
      {currentStep===5&&(
        <Card>
          <Sub>Step 5 — Accept Forecast</Sub>
          <div style={{marginBottom:16}}>
            <span style={sectionLabel}>Output format</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {[["headcount","👤 Headcount summary"],["hours","⏱ Hours per role"],["skeleton","📅 Weekly skeleton"]].map(([v,l])=>pillBtn(outputFormat===v,()=>setOutputFormat(v),l))}
            </div>
            <div style={{fontSize:11,color:CN.mid,marginTop:8}}>
              {outputFormat==="headcount"&&"Creates a role scenario with the suggested headcount. No hours pre-filled."}
              {outputFormat==="hours"&&"Creates a plan scenario with total weekly hours per role, distributed evenly."}
              {outputFormat==="skeleton"&&"Creates a full day-by-day schedule using the "+distMode+" distribution."}
            </div>
          </div>
          <Note type="info">Creates new Role Scenario and Schedule Scenario labelled "Forecast — {fmtWeek(weekOf)}". You can rename them after.</Note>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:20,paddingTop:16,borderTop:`1px solid ${CN.border}`}}>
            <button onClick={()=>setCurrentStep(4)} style={{padding:"9px 18px",borderRadius:10,border:`1.5px solid ${CN.border}`,backgroundColor:CN.white,color:CN.mid,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'Barlow Semi Condensed',sans-serif"}}>← Back</button>
            <Btn onClick={acceptForecast}>✓ Accept &amp; Create Scenarios</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────
const SIDEBAR_W=220;

function Sidebar({tab,navGroups,currentUser,logoUrl,setLogoUrl,isAdmin,actingAsUser,setActingAsUser,tabSwitcher,isMobile,open,onClose,tabIcons,setTabIcons}){
  const sb={position:"fixed",top:0,left:0,bottom:0,width:SIDEBAR_W,backgroundColor:CN.sidebarBg,display:"flex",flexDirection:"column",zIndex:300,transition:"transform 0.25s ease",transform:isMobile?(open?"translateX(0)":"translateX(-100%)"):"translateX(0)",boxShadow:isMobile&&open?"4px 0 24px rgba(0,0,0,0.4)":undefined,overflowY:"auto"};

  const sidebarBtnBase={display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 16px",border:"none",background:"transparent",color:CN.sidebarText,cursor:"pointer",fontSize:12,fontFamily:"'Barlow Semi Condensed',sans-serif",textAlign:"left",outline:"none",transition:"background 0.1s"};

  return(
    <>
      {isMobile&&open&&<div onClick={onClose} style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.5)",zIndex:299}}/>}
      <div style={sb}>
        {/* Logo area */}
        <div style={{padding:"20px 16px 16px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>document.getElementById("cn-logo-upload").click()}>
            <div style={{width:36,height:36,borderRadius:8,border:"1.5px dashed rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",backgroundColor:"rgba(255,255,255,0.06)",flexShrink:0}}>
              {logoUrl?<img src={logoUrl} alt="Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<span style={{fontSize:18,opacity:0.5}}>🏢</span>}
            </div>
            <input id="cn-logo-upload" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>setLogoUrl(ev.target.result);reader.readAsDataURL(file);e.target.value="";}}/>
            <div>
              <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:15,letterSpacing:"0.08em",textTransform:"uppercase",color:"rgba(255,255,255,0.9)",lineHeight:1.1}}>Cheeky Noodles</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginTop:1}}>Headcount Planner</div>
            </div>
          </div>
        </div>

        {/* Nav groups */}
        <div style={{flex:1,padding:"8px 0",overflowY:"auto"}}>
          {navGroups.map((group,gi)=>(
            <div key={gi} style={{marginBottom:4}}>
              <div style={{padding:"8px 16px 4px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:CN.sidebarLabel}}>{group.label}</div>
              {group.items.map(item=>{
                const active=tab===item.id;
                return(
                  <button key={item.id} onClick={()=>{tabSwitcher(item.id);if(isMobile)onClose();}}
                    style={{...sidebarBtnBase,fontSize:13,fontWeight:active?700:400,background:active?CN.sidebarActive:"transparent",color:active?"rgba(255,255,255,1)":CN.sidebarText,borderLeft:active?`3px solid ${CN.orange}`:"3px solid transparent",padding:"9px 16px"}}>
                    <span style={{fontSize:15,flexShrink:0}}>{item.icon}</span>
                    <span style={{flex:1}}>{item.label}</span>
                    {item.dirty&&<span style={{width:6,height:6,borderRadius:"50%",backgroundColor:CN.orange,flexShrink:0}}/>}
                  </button>
                );
              })}
              {gi<navGroups.length-1&&<div style={{height:1,backgroundColor:"rgba(255,255,255,0.05)",margin:"6px 0"}}/>}
            </div>
          ))}
        </div>

        {/* Bottom area */}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",padding:"8px 0"}}>

          {/* Admin view toggle */}
          {isAdmin&&(
            <button onClick={()=>{setActingAsUser(v=>!v);if(tab==="admin")tabSwitcher("summary");}} style={sidebarBtnBase}>
              <span style={{fontSize:14}}>{!actingAsUser?"🔐":"👤"}</span>
              <span>{!actingAsUser?"Admin view":"User view"}</span>
            </button>
          )}

          {/* System tools — Radix Popover */}
          <Popover.Root>
            <Popover.Trigger asChild>
              <button style={sidebarBtnBase}>
                <span style={{fontSize:14}}>⚙️</span>
                <span>System Tools</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="right" align="end" sideOffset={8}
                style={{
                  width:300,backgroundColor:CN.white,borderRadius:12,
                  boxShadow:"0 8px 32px rgba(0,0,0,0.2)",border:`1px solid ${CN.border}`,
                  overflow:"hidden",outline:"none",zIndex:500,
                  fontFamily:"'Barlow Semi Condensed',sans-serif",
                }}
              >
                <div style={{padding:"11px 16px",backgroundColor:CN.creamDark,borderBottom:`1px solid ${CN.border}`,fontWeight:700,fontSize:13,color:CN.dark}}>⚙️ System Tools</div>

                {/* Logo section */}
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${CN.border}`}}>
                  <div style={{fontSize:11,fontWeight:600,color:CN.mid,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Logo</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:44,height:44,borderRadius:6,border:`1px solid ${CN.border}`,overflow:"hidden",backgroundColor:CN.creamDark,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {logoUrl?<img src={logoUrl} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<span style={{fontSize:20,opacity:0.4}}>🏢</span>}
                    </div>
                    <div style={{flex:1}}>
                      <button onClick={()=>document.getElementById("cn-logo-upload").click()} style={{fontSize:12,padding:"5px 10px",borderRadius:6,border:`1px solid ${CN.border}`,backgroundColor:CN.white,cursor:"pointer",fontFamily:"'Barlow Semi Condensed',sans-serif",color:CN.dark,display:"block",width:"100%",marginBottom:4}}>
                        {logoUrl?"Replace logo":"Upload logo"}
                      </button>
                      {logoUrl&&(
                        <button onClick={()=>setLogoUrl(null)} style={{fontSize:11,padding:"4px 10px",borderRadius:6,border:`1px solid ${CN.border}`,backgroundColor:CN.white,cursor:"pointer",fontFamily:"'Barlow Semi Condensed',sans-serif",color:CN.red,display:"block",width:"100%"}}>Remove logo</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tab icons section */}
                <div style={{padding:"14px 16px"}}>
                  <div style={{fontSize:11,fontWeight:600,color:CN.mid,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Tab Icons</div>
                  {[
                    {id:"roles", label:"Job Roles",  options:["👥","👤","🧑‍💼","👷","🧑‍🍳"]},
                    {id:"plan",  label:"Schedule",   options:["📋","📅","🗓️","📆","🗒️"]},
                    {id:"summary",label:"Summary",   options:["📊","📈","💰","🧾","📉"]},
                  ].map(row=>(
                    <div key={row.id} style={{marginBottom:10}}>
                      <div style={{fontSize:12,color:CN.dark,marginBottom:5,fontWeight:500}}>{row.label}</div>
                      <div style={{display:"flex",gap:4}}>
                        {row.options.map(icon=>(
                          <button key={icon} onClick={()=>setTabIcons(prev=>({...prev,[row.id]:icon}))}
                            style={{fontSize:17,padding:"4px 7px",borderRadius:6,cursor:"pointer",border:tabIcons[row.id]===icon?`2px solid ${CN.orange}`:"2px solid transparent",backgroundColor:tabIcons[row.id]===icon?CN.orangeLight:"transparent"}}>
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <Popover.Arrow style={{fill:CN.border}}/>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* User menu — Radix DropdownMenu */}
          <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",marginTop:4}}>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button style={{...sidebarBtnBase,color:CN.white,padding:"10px 16px",width:"100%"}}>
                  {currentUser?.avatar
                    ?<img src={currentUser.avatar} alt="" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
                    :<div style={{width:28,height:28,borderRadius:"50%",backgroundColor:CN.orange,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,flexShrink:0}}>{(currentUser?.name?.[0]||"?").toUpperCase()}</div>
                  }
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser?.name}</div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser?.email}</div>
                  </div>
                  <span style={{fontSize:9,opacity:0.5,flexShrink:0}}>▲</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="right" align="end" sideOffset={8}
                  style={{
                    width:SIDEBAR_W-16,backgroundColor:CN.white,
                    border:`1px solid ${CN.border}`,borderRadius:10,
                    boxShadow:"0 8px 24px rgba(0,0,0,0.15)",
                    overflow:"hidden",outline:"none",zIndex:500,
                    fontFamily:"'Barlow Semi Condensed',sans-serif",
                  }}
                >
                  <div style={{padding:"10px 12px",borderBottom:`1px solid ${CN.border}`,backgroundColor:CN.creamDark}}>
                    <div style={{fontSize:13,fontWeight:600,color:CN.dark}}>{currentUser?.name}</div>
                    <div style={{fontSize:11,color:CN.mid}}>{currentUser?.email}</div>
                  </div>
                  <DropdownMenu.Item asChild>
                    <button
                      onClick={()=>window.Clerk?.signOut()}
                      style={{display:"block",width:"100%",padding:"10px 12px",background:"none",border:"none",textAlign:"left",fontSize:13,fontWeight:600,color:CN.red,cursor:"pointer",fontFamily:"'Barlow Semi Condensed',sans-serif",outline:"none"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#FEE2E2"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}
                    >
                      Sign out
                    </button>
                  </DropdownMenu.Item>
                  <DropdownMenu.Arrow style={{fill:CN.border}}/>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

        </div>
      </div>
    </>
  );
}

// ── Mobile top bar ────────────────────────────────────────────────
function MobileTopBar({onMenuOpen,tab,navGroups}){
  const activeItem=navGroups.flatMap(g=>g.items).find(i=>i.id===tab);
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,height:52,backgroundColor:CN.dark,display:"flex",alignItems:"center",gap:12,padding:"0 16px",zIndex:200,boxShadow:"0 2px 12px rgba(0,0,0,0.3)"}}>
      <button onClick={onMenuOpen} style={{border:"none",background:"rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 10px",cursor:"pointer",color:"rgba(255,255,255,0.9)",fontSize:16,lineHeight:1}}>☰</button>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'Bowlby One SC',sans-serif",fontWeight:800,fontSize:16,letterSpacing:"0.08em",textTransform:"uppercase",color:CN.white}}>{activeItem?.icon} {activeItem?.label||"Cheeky Noodles"}</div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────
export default function App({currentUser}){
  const[tab,setTab]=useState("summary");
  const isMobile=useIsMobile();
  const SK=useMemo(()=>userSK(currentUser.id),[currentUser.id]);
  const loadDone=useRef(false);
  const[sidebarOpen,setSidebarOpen]=useState(false);

  const[roleScenarios,setRoleScenarios]=useState(null);
  const[planScenarios,setPlanScenarios]=useState(null);
  const[taxYears,setTaxYears]=useState(null);
  const[ot,setOt]=useState(null);
  const[savedRS,setSavedRS]=useState(null);
  const[savedPS,setSavedPS]=useState(null);
  const[savedTaxYears,setSavedTaxYears]=useState(null);
  const[savedOt,setSavedOt]=useState(null);
  const[selectedTaxYear,setSelectedTaxYear]=useState(new Date().getFullYear());
  const[admins,setAdmins]=useState([]);
  const[allUsers,setAllUsers]=useState([]);
  const isAdmin=admins.includes(currentUser.id);
  const noAdminsYet=admins.length===0;
  const[actingAsUser,setActingAsUser]=useState(false);
  const effectiveAdmin=isAdmin&&!actingAsUser;
  const lastKnownAt=useRef({});
  const[loading,setLoading]=useState(true);
  const[logoUrl,setLogoUrl]=useState(null);
  const[tabIcons,setTabIcons]=useState(DEFAULT_TAB_ICONS);
  const[saving,setSaving]=useState({roles:false,plans:false,settings:false});

  useEffect(()=>{
    const link=document.createElement("link");link.rel="stylesheet";link.href="https://fonts.googleapis.com/css2?family=Bowlby+One+SC&family=Barlow+Semi+Condensed:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap";document.head.appendChild(link);
    document.body.style.margin="0";document.body.style.padding="0";document.body.style.backgroundColor=CN.cream;
    return()=>{};
  },[]);

  const registerUser=useCallback(async()=>{
    const registry=await loadS(SHARED_SK.userRegistry,[]);
    const now=new Date().toISOString();const existing=registry.find(u=>u.id===currentUser.id);
    const updated=existing?registry.map(u=>u.id===currentUser.id?{...u,lastSeen:now,name:currentUser.name,avatar:currentUser.avatar}:u):[...registry,{...currentUser,lastSeen:now}];
    await saveS(SHARED_SK.userRegistry,updated);return updated;
  },[currentUser.id,currentUser.name,currentUser.email,currentUser.avatar]);

  const migrate=useCallback(async()=>{
    const defaultRoles=DEFAULT_ROLES.map(r=>({...r,exempt:r.payType==="Salary"}));
    const defaultRS={scenarios:[makeRoleScenario("Default",defaultRoles,true)],activeId:null};defaultRS.activeId=defaultRS.scenarios[0].id;
    const defaultPS={scenarios:[makePlanScenario("Default",defaultRS.scenarios[0].id,true)],activeId:null};defaultPS.activeId=defaultPS.scenarios[0].id;
    const sharedRS=await loadS(SK.sharedRoleScenarios,null);const sharedPS=await loadS(SK.sharedPlanScenarios,null);
    if(sharedRS){const rs={...sharedRS,scenarios:sharedRS.scenarios.map((s,i)=>i===0?{...s,isDefault:true}:s)};const ps=sharedPS?{...sharedPS,scenarios:sharedPS.scenarios.map((s,i)=>i===0?{...s,isDefault:true}:s)}:defaultPS;return{rs,ps};}
    const legacyRoles=await loadS(SK.legacyRoles,null);const legacyPlans=await loadS(SK.legacyPlans,null);
    if(legacyRoles){const rs={scenarios:[makeRoleScenario("Default",legacyRoles,true)],activeId:null};rs.activeId=rs.scenarios[0].id;const ps={scenarios:[makePlanScenario("Default",rs.scenarios[0].id,true)],activeId:null};if(legacyPlans)ps.scenarios[0].plans=legacyPlans;ps.activeId=ps.scenarios[0].id;return{rs,ps};}
    return{rs:defaultRS,ps:defaultPS};
  },[SK]);

  const loadAll=useCallback(async(showLoader=true)=>{
    if(showLoader)setLoading(true);
    const[updatedRegistry,adminList]=await Promise.all([registerUser(),loadS(SHARED_SK.admins,[])]);
    setAllUsers(updatedRegistry);setAdmins(adminList);
    const rsData=await loadSWithTs(SK.roleScenarios,null);const psData=await loadSWithTs(SK.planScenarios,null);
    let migrated=null;const getMigrated=async()=>{if(!migrated)migrated=await migrate();return migrated;};
    let rs=rsData.value;if(!rs){rs=(await getMigrated()).rs;}
    if(rs&&rs.scenarios.length>0&&!rs.scenarios.some(s=>s.isDefault)){rs={...rs,scenarios:rs.scenarios.map((s,i)=>i===0?{...s,isDefault:true}:s)};}
    setRoleScenarios(rs);setSavedRS(deepClone(rs));lastKnownAt.current[SK.roleScenarios]=rsData.updated_at;
    let ps=psData.value;if(!ps){ps=(await getMigrated()).ps;}
    if(ps&&ps.scenarios.length>0&&!ps.scenarios.some(s=>s.isDefault)){ps={...ps,scenarios:ps.scenarios.map((s,i)=>i===0?{...s,isDefault:true}:s)};}
    setPlanScenarios(ps);setSavedPS(deepClone(ps));lastKnownAt.current[SK.planScenarios]=psData.updated_at;
    const tyData=await loadSWithTs(SHARED_SK.taxYears,null);let ty=tyData.value;
    if(!ty){const oldTax=await loadS(SHARED_SK.tax,null);const year=new Date().getFullYear();ty=oldTax?{[year]:{...DEFAULT_TAX,...oldTax}}:{};}
    setTaxYears(ty);setSavedTaxYears(deepClone(ty));lastKnownAt.current[SHARED_SK.taxYears]=tyData.updated_at;
    const oData=await loadSWithTs(SHARED_SK.ot,DEFAULT_OT);const o={...DEFAULT_OT,...oData.value};
    setOt(o);setSavedOt(deepClone(o));lastKnownAt.current[SHARED_SK.ot]=oData.updated_at;
    const si=await loadS(SHARED_SK.icons,DEFAULT_TAB_ICONS);setTabIcons({...DEFAULT_TAB_ICONS,...si});
    const sl=await loadS(SHARED_SK.logo,null);if(sl)setLogoUrl(sl);
    if(showLoader)setLoading(false);
  },[SK,migrate,registerUser]);

  useEffect(()=>{if(!loadDone.current){loadDone.current=true;loadAll();}},[loadAll]);
  useEffect(()=>{saveS(SHARED_SK.icons,tabIcons);},[tabIcons]);
  useEffect(()=>{if(logoUrl!==null)saveS(SHARED_SK.logo,logoUrl);},[logoUrl]);

  const doSave=useCallback(async(section,items)=>{
    setSaving(s=>({...s,[section]:true}));
    for(const item of items){
      const result=await window.storage.checkAndSet(item.key,JSON.stringify(item.val),lastKnownAt.current[item.key]);
      if(!result){setSaving(s=>({...s,[section]:false}));return;}
      if(result.conflict)await saveS(item.key,item.val);
      item.setSaved(deepClone(item.val));lastKnownAt.current[item.key]=result.updated_at||new Date().toISOString();
    }
    setSaving(s=>({...s,[section]:false}));
  },[]);

  const saveRoles=()=>doSave("roles",[{key:SK.roleScenarios,val:roleScenarios,setSaved:setSavedRS}]);
  const savePlans=()=>doSave("plans",[{key:SK.planScenarios,val:planScenarios,setSaved:setSavedPS}]);
  const saveSettings=()=>doSave("settings",[{key:SHARED_SK.taxYears,val:taxYears,setSaved:setSavedTaxYears},{key:SHARED_SK.ot,val:ot,setSaved:setSavedOt}]);
  const clearRoles=()=>setRoleScenarios(deepClone(savedRS));
  const clearPlansWeek=(weekOf)=>setPlanScenarios(prev=>({...prev,scenarios:prev.scenarios.map(s=>s.id===prev.activeId?{...s,plans:[...s.plans.filter(p=>p.weekOf!==weekOf),...(savedPS.scenarios.find(ss=>ss.id===prev.activeId)?.plans.filter(p=>p.weekOf===weekOf)||[])]}:s)}));
  const clearSettings=()=>{setTaxYears(deepClone(savedTaxYears));setOt(deepClone(savedOt));};
  const claimAdmin=async()=>{const updated=[currentUser.id];await saveS(SHARED_SK.admins,updated);setAdmins(updated);};
  const promoteUser=async(userId)=>{const updated=[...admins,userId];await saveS(SHARED_SK.admins,updated);setAdmins(updated);};
  const demoteUser=async(userId)=>{const updated=admins.filter(id=>id!==userId);await saveS(SHARED_SK.admins,updated);setAdmins(updated);};

  const rolesDirty=!!savedRS&&JSON.stringify(roleScenarios)!==JSON.stringify(savedRS);
  const plansDirty=!!savedPS&&JSON.stringify(planScenarios)!==JSON.stringify(savedPS);
  const settingsDirty=!!savedTaxYears&&(JSON.stringify(taxYears)!==JSON.stringify(savedTaxYears)||JSON.stringify(ot)!==JSON.stringify(savedOt));

  const navGroups=[
    {label:"Operations",items:[
      {id:"forecast",label:"Forecaster",icon:"🔮"},
      {id:"plan",label:"Schedule",icon:tabIcons.plan,dirty:plansDirty},
    ]},
    {label:"Insights",items:[
      {id:"summary",label:"Summary",icon:tabIcons.summary},
    ]},
    {label:"Configuration",items:[
      {id:"roles",label:"Job Roles",icon:tabIcons.roles,dirty:rolesDirty},
      {id:"settings",label:"Taxes & Regs",icon:"⚖️",dirty:settingsDirty},
    ]},
    ...(effectiveAdmin?[{label:"Admin",items:[{id:"admin",label:"Admin Panel",icon:"🔐"}]}]:[]),
  ];

  const tabSwitcher=(newTab)=>{setTab(newTab);setSidebarOpen(false);};

  if(loading)return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",backgroundColor:CN.cream}}>
      <div style={{color:CN.mid,fontSize:14,fontFamily:"sans-serif"}}>Loading…</div>
    </div>
  );

  const contentStyle={
    marginLeft:isMobile?0:SIDEBAR_W,
    minHeight:"100vh",
    backgroundColor:CN.cream,
    transition:"margin-left 0.25s ease",
    paddingTop:isMobile?52:0,
  };

  const innerPad={maxWidth:1100,margin:"0 auto",padding:isMobile?"16px 12px":"32px 32px"};

  return(
    <Tooltip.Provider delayDuration={300}>
    <div style={{display:"flex",minHeight:"100vh",backgroundColor:CN.sidebarBg}}>
      <Sidebar
        tab={tab} navGroups={navGroups}
        currentUser={currentUser}
        isAdmin={isAdmin} actingAsUser={actingAsUser} setActingAsUser={setActingAsUser}
        logoUrl={logoUrl} setLogoUrl={setLogoUrl}
        tabSwitcher={tabSwitcher} isMobile={isMobile} open={sidebarOpen} onClose={()=>setSidebarOpen(false)}
        tabIcons={tabIcons} setTabIcons={setTabIcons}
      />

      {isMobile&&<MobileTopBar onMenuOpen={()=>setSidebarOpen(true)} tab={tab} navGroups={navGroups}/>}

      <div style={contentStyle}>
        {/* No admin banner */}
        {noAdminsYet&&(
          <div style={{backgroundColor:CN.amberLight,borderBottom:`1px solid ${CN.amber}`,padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:13,color:"#92400E",fontWeight:500}}>⚠️ No admin set up yet.</span>
            <button onClick={claimAdmin} style={{padding:"6px 16px",backgroundColor:CN.amber,color:CN.white,border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'Bowlby One SC',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>Claim Admin Access</button>
          </div>
        )}

        <div style={innerPad}>
          {tab==="roles"&&roleScenarios&&<RolesTab roleScenarios={roleScenarios} setRoleScenarios={setRoleScenarios} taxYears={taxYears} ot={ot} isAdmin={effectiveAdmin} dirty={rolesDirty} onSave={saveRoles} onClear={clearRoles} saving={saving.roles} isMobile={isMobile}/>}
          {tab==="plan"&&planScenarios&&roleScenarios&&<PlanTab roleScenarios={roleScenarios} planScenarios={planScenarios} setPlanScenarios={setPlanScenarios} taxYears={taxYears} ot={ot} isAdmin={effectiveAdmin} dirty={plansDirty} onSave={savePlans} onClear={clearPlansWeek} saving={saving.plans} isMobile={isMobile}/>}
          {tab==="summary"&&<SummaryTab roleScenarios={roleScenarios||{scenarios:[]}} planScenarios={planScenarios||{scenarios:[]}} taxYears={taxYears} ot={ot} onRefresh={()=>loadAll(false)}/>}
          {tab==="settings"&&taxYears&&ot&&<TaxTab taxYears={taxYears} setTaxYears={setTaxYears} selectedYear={selectedTaxYear} setSelectedYear={setSelectedTaxYear} ot={ot} setOt={setOt} dirty={settingsDirty} onSave={saveSettings} onClear={clearSettings} saving={saving.settings} isMobile={isMobile}/>}
          {tab==="forecast"&&roleScenarios&&planScenarios&&<ForecasterTab roleScenarios={roleScenarios} setRoleScenarios={setRoleScenarios} planScenarios={planScenarios} setPlanScenarios={setPlanScenarios} taxYears={taxYears} ot={ot} isMobile={isMobile} onAccepted={()=>{saveRoles();savePlans();}}/>}
          {tab==="admin"&&effectiveAdmin&&<AdminTab currentUser={currentUser} allUsers={allUsers} admins={admins} onPromote={promoteUser} onDemote={demoteUser} onRefresh={()=>loadAll(false)} isMobile={isMobile}/>}
        </div>
      </div>
    </div>
    </Tooltip.Provider>
  );
}