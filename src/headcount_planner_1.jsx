import { useState, useEffect, useCallback } from "react";

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
  };
}

// ── Brand ─────────────────────────────────────────────────────────
const CN = {
  orange: "#F43A0A", orangeHover: "#D4320A", orangeLight: "#FDE8E2",
  cream: "#FAF4E4", creamDark: "#F0E8D0", dark: "#1C1208", mid: "#7A6A58",
  border: "#E0D4BC", white: "#FFFFFF", amber: "#F59E0B", amberLight: "#FEF3C7",
  amberDark: "#D97706", red: "#DC2626", redLight: "#FEE2E2",
  blue: "#2563EB", blueLight: "#DBEAFE", purple: "#7C3AED", purpleLight: "#EDE9FE",
};

const DEFAULT_TAX = {
  federalSS: 6.2, federalMedicare: 1.45, futa: 0.6,
  waSUI: 1.2, waLnI: 1.85, waPFML: 0,
  ssWageBase: 176100, suiWageBase: 72800,
  minWage: 16.66, effectiveDate: "Jan 1, 2025",
};
const DEFAULT_OT = { weeklyThreshold: 40, dailyMax: 10, multiplier: 1.5 };
const DEFAULT_TAB_ICONS = { roles:"👥", plan:"📋", summary:"📊" };

const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const CATEGORIES = ["BOH","FOH","Management","Other"];
const PAY_TYPES = ["Hourly","Salary"];
const DEFAULT_BENEFITS = { healthMonthly:0, dentalMonthly:0, visionMonthly:0, retirement401k:0, otherMonthly:0 };

const SK = { roles:"cn-hc-roles-v4", plans:"cn-hc-plans-v4", tax:"cn-hc-tax-v3", ot:"cn-hc-ot-v4", logo:"cn-hc-logo-v1", icons:"cn-hc-tab-icons-v1" };

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

const DEFAULT_ROLES = [
  {id:uid(),name:"Line Cook",       category:"BOH",        payType:"Hourly",rate:18,  defaultHours:35,otEligible:true, benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Prep / Dishwasher",category:"BOH",       payType:"Hourly",rate:16,  defaultHours:30,otEligible:true, benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Counter / Cashier",category:"FOH",       payType:"Hourly",rate:16,  defaultHours:30,otEligible:true, benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Delivery Runner",  category:"FOH",       payType:"Hourly",rate:15,  defaultHours:20,otEligible:true, benefits:{...DEFAULT_BENEFITS},active:true},
  {id:uid(),name:"Manager",          category:"Management",payType:"Salary", rate:4500,defaultHours:45,otEligible:false,benefits:{...DEFAULT_BENEFITS,healthMonthly:300},active:true},
];

// ── Cost calculation ──────────────────────────────────────────────
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
    wages = role.rate/4.33;
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

// ── Row/day status helpers ────────────────────────────────────────
function rowStatus(role, dayHours, ot) {
  const O = ot||DEFAULT_OT;
  const totalHrs = DAYS.reduce((s,d)=>s+(parseFloat(dayHours[d])||0),0);
  const maxDay = Math.max(...DAYS.map(d=>parseFloat(dayHours[d])||0));
  if (O.dailyMax>0 && maxDay>O.dailyMax) return "daymax";
  if (role.otEligible && totalHrs>O.weeklyThreshold) return "ot";
  if (role.otEligible && totalHrs>=O.weeklyThreshold*0.85) return "nearot";
  return "ok";
}

const STATUS = {
  ok:     { rowBg:"transparent",          icon:null,  tagBg:"transparent",       tagText:"" },
  nearot: { rowBg:"#FFFDF0",              icon:"🔶",  tagBg:CN.amberLight,       tagText:"Near OT" },
  ot:     { rowBg:"#FEF3C7",              icon:"⚠️",  tagBg:"#FDE68A",           tagText:"Overtime" },
  daymax: { rowBg:"#FEE2E2",              icon:"🚨",  tagBg:"#FECACA",           tagText:"Daily Max" },
};

// ── Storage ───────────────────────────────────────────────────────
async function loadS(key,fallback) { try{const r=await window.storage.get(key);return r?JSON.parse(r.value):fallback;}catch{return fallback;} }
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
  const s={info:{bg:CN.creamDark,border:CN.border,text:CN.mid},warning:{bg:CN.amberLight,border:CN.amber,text:"#92400E"},alert:{bg:CN.orangeLight,border:CN.orange,text:CN.orangeHover}};
  const st=s[type];
  return <div style={{backgroundColor:st.bg,border:`1px solid ${st.border}`,borderRadius:"8px",padding:"10px 14px",fontSize:"12px",color:st.text,marginBottom:"12px"}}>{children}</div>;
}

// th / td base
const TH = {padding:"9px 8px",backgroundColor:CN.creamDark,border:`1px solid ${CN.border}`,fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.mid,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"};
const TD = {padding:"0",fontSize:"13px",fontFamily:"'DM Sans',sans-serif",verticalAlign:"middle",border:`1px solid ${CN.creamDark}`};

// ── Role Form ─────────────────────────────────────────────────────
function RoleForm({initial,onSave,onCancel,tax,ot}) {
  const blank={name:"",category:"BOH",payType:"Hourly",rate:"",defaultHours:35,otEligible:true,benefits:{...DEFAULT_BENEFITS},active:true};
  const [f,setF]=useState(initial?{...initial,benefits:{...DEFAULT_BENEFITS,...(initial.benefits||{})}}:blank);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const setB=(k,v)=>setF(p=>({...p,benefits:{...p.benefits,[k]:v}}));
  const valid=f.name.trim()&&f.rate!==""&&Number(f.rate)>0;
  const minW=f.payType==="Hourly"&&Number(f.rate)>0&&Number(f.rate)<(tax?.minWage||DEFAULT_TAX.minWage);
  const previewDays=DAYS.reduce((a,d,i)=>({...a,[d]:i<5?(f.defaultHours||0)/5:0}),{});
  const prev=valid?calcRowCost({...f,rate:Number(f.rate)},previewDays,tax,ot):null;

  return (
    <Card style={{border:`1.5px solid ${CN.orange}`,marginBottom:"12px"}}>
      <Sub>{initial?"Edit Role":"Add New Role"}</Sub>
      {minW&&<Note type="alert">⚠️ Rate ${f.rate}/hr is below WA minimum wage ${tax?.minWage||DEFAULT_TAX.minWage}/hr ({tax?.effectiveDate||"Jan 1, 2025"}).</Note>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <div style={{gridColumn:"1/-1"}}><Field label="Job Title" value={f.name} onChange={v=>set("name",v)} placeholder="e.g. Line Cook"/></div>
        <Pick label="Category" value={f.category} onChange={v=>set("category",v)} options={CATEGORIES}/>
        <Pick label="Pay Type" value={f.payType} onChange={v=>{set("payType",v);if(v==="Salary")set("otEligible",false);}} options={PAY_TYPES}/>
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
        <Btn onClick={()=>valid&&onSave({...f,id:initial?.id||uid(),rate:Number(f.rate)})} style={{opacity:valid?1:0.4}}>
          {initial?"Save Changes":"Add Role"}
        </Btn>
        <Btn onClick={onCancel} variant="secondary">Cancel</Btn>
      </div>
    </Card>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────
function RolesTab({roles,setRoles,tax,ot}) {
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState(null);
  const save=(role)=>{setRoles(rs=>rs.find(r=>r.id===role.id)?rs.map(r=>r.id===role.id?role:r):[...rs,role]);setAdding(false);setEditing(null);};
  const toggle=(id)=>setRoles(rs=>rs.map(r=>r.id===id?{...r,active:!r.active}:r));
  const remove=(id)=>{if(window.confirm("Remove this role?"))setRoles(rs=>rs.filter(r=>r.id!==id));};
  const grouped=CATEGORIES.reduce((a,c)=>{a[c]=roles.filter(r=>r.category===c);return a;},{});

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}}>
        <SHead title="Job Roles" sub="Define roles and rates. Each active role appears as a row option in the weekly schedule."/>
        {!adding&&!editing&&<Btn onClick={()=>setAdding(true)}>+ Add Role</Btn>}
      </div>
      {adding&&<RoleForm onSave={save} onCancel={()=>setAdding(false)} tax={tax} ot={ot}/>}
      {CATEGORIES.map(cat=>grouped[cat].length===0?null:(
        <div key={cat} style={{marginBottom:"24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
            <Tag cat={cat}/><span style={{fontSize:"12px",color:CN.mid}}>{grouped[cat].length} role{grouped[cat].length!==1?"s":""}</span>
          </div>
          {grouped[cat].map(role=>(
            editing===role.id
              ?<RoleForm key={role.id} initial={role} onSave={save} onCancel={()=>setEditing(null)} tax={tax} ot={ot}/>
              :(
                <Card key={role.id} style={{padding:"14px 18px",opacity:role.active?1:0.5,marginBottom:"8px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"3px"}}>
                        <span style={{fontWeight:600,fontSize:"14px",color:CN.dark}}>{role.name}</span>
                        {role.otEligible&&<span style={{fontSize:"10px",fontWeight:700,backgroundColor:CN.amberLight,color:"#92400E",padding:"1px 7px",borderRadius:"99px"}}>OT eligible</span>}
                        {!role.active&&<span style={{fontSize:"11px",color:CN.mid}}>(inactive)</span>}
                      </div>
                      <div style={{fontSize:"12px",color:CN.mid}}>
                        {role.payType==="Hourly"?`${fmt$(role.rate)}/hr · ${role.defaultHours}h/wk default`:`${fmt$(role.rate)}/mo salary`}
                      </div>
                    </div>
                    <div style={{textAlign:"right",marginRight:"8px"}}>
                      <div style={{fontSize:"10px",color:CN.mid}}>Weekly all-in (1 emp.)</div>
                      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"18px",fontWeight:800,color:CN.orange}}>
                        {fmt$(calcRowCost(role,DAYS.reduce((a,d,i)=>({...a,[d]:i<5?role.defaultHours/5:0}),{}),tax,ot).total)}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                      <Btn variant="ghost" onClick={()=>setEditing(role.id)}>Edit</Btn>
                      <Btn variant="ghost" onClick={()=>toggle(role.id)} style={{color:CN.mid}}>{role.active?"Deactivate":"Activate"}</Btn>
                      <Btn variant="danger" onClick={()=>remove(role.id)}>Remove</Btn>
                    </div>
                  </div>
                </Card>
              )
          ))}
        </div>
      ))}
      {roles.length===0&&!adding&&(
        <div style={{textAlign:"center",padding:"56px",color:CN.mid}}>
          <div style={{fontSize:"48px",marginBottom:"12px"}}>👥</div>
          <p style={{fontSize:"13px"}}>No roles yet. Add your first role to get started.</p>
        </div>
      )}
    </div>
  );
}

// ── Plan Tab — Day-by-day scheduling grid ─────────────────────────
function PlanTab({roles,plans,setPlans,tax,ot}) {
  const [selectedWeek,setSelectedWeek]=useState(isoMonday(toMonday(new Date())));
  const [activeDayIdx,setActiveDayIdx]=useState(()=>{ const d=new Date().getDay(); return d===0?6:d-1; });
  const isMobile=useIsMobile();
  const active=roles.filter(r=>r.active);
  const weekPlans=plans.filter(p=>p.weekOf===selectedWeek);
  const O=ot||DEFAULT_OT;

  const updateDay=(planId,day,val)=>{
    const num=val===""?"":(Math.round(parseFloat(val)*2)/2);
    setPlans(ps=>ps.map(p=>p.id===planId?{...p,days:{...p.days,[day]:num}}:p));
  };

  const addRow=(roleId)=>setPlans(ps=>[...ps,{id:uid(),weekOf:selectedWeek,roleId,days:emptyDays()}]);
  const removeRow=(planId)=>setPlans(ps=>ps.filter(p=>p.id!==planId));
  const shift=(n)=>{const d=new Date(selectedWeek+"T00:00:00");d.setDate(d.getDate()+n*7);setSelectedWeek(isoMonday(d));};

  const copyPrev=()=>{
    const prev=new Date(selectedWeek+"T00:00:00");prev.setDate(prev.getDate()-7);
    const prevStr=isoMonday(prev);
    const prevPlans=plans.filter(p=>p.weekOf===prevStr);
    if(!prevPlans.length){alert("No plan found for previous week.");return;}
    setPlans(ps=>[...ps.filter(p=>p.weekOf!==selectedWeek),...prevPlans.map(p=>({...p,id:uid(),weekOf:selectedWeek}))]);
  };

  // Aggregate totals
  const totals=weekPlans.reduce((acc,plan)=>{
    const role=roles.find(r=>r.id===plan.roleId);
    if(!role)return acc;
    const c=calcRowCost(role,plan.days,tax,ot);
    return{wages:acc.wages+c.wages,taxes:acc.taxes+c.taxes,benefits:acc.benefits+c.benefits,total:acc.total+c.total,otHrs:acc.otHrs+c.otHrs,totalHrs:acc.totalHrs+c.totalHrs};
  },{wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0});

  const dayTotals=DAYS.reduce((acc,d)=>({...acc,[d]:weekPlans.reduce((s,p)=>s+(parseFloat(p.days[d])||0),0)}),{});
  const grouped=CATEGORIES.reduce((a,c)=>({...a,[c]:active.filter(r=>r.category===c)}),{});

  if(!active.length) return (
    <div style={{textAlign:"center",padding:"56px",color:CN.mid}}>
      <div style={{fontSize:"48px",marginBottom:"12px"}}>📋</div>
      <p>Set up job roles first.</p>
    </div>
  );

  return (
    <div>
      {/* Week nav */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px",flexWrap:"wrap",gap:"10px"}}>
        <SHead title="Weekly Schedule" sub="Enter hours per employee per day. Rows highlight when overtime or daily limits are breached."/>
        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
          <Btn variant="secondary" onClick={()=>shift(-1)} style={{padding:"6px 14px"}}>←</Btn>
          <span style={{fontSize:"13px",fontWeight:600,color:CN.dark,minWidth:"220px",textAlign:"center"}}>{fmtWeek(selectedWeek)}</span>
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

      {/* Table — desktop: all 7 days; mobile: single day with nav */}
      {isMobile ? (
        <div>
          {/* Day selector */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px",backgroundColor:CN.white,borderRadius:"12px",padding:"10px 14px",border:`1.5px solid ${CN.border}`}}>
            <button onClick={()=>setActiveDayIdx(i=>(i+6)%7)}
              style={{border:"none",background:CN.creamDark,borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:"16px",fontWeight:700,color:CN.dark}}>←</button>
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:"20px",color:CN.dark,textTransform:"uppercase",letterSpacing:"0.06em"}}>{DAY_LABELS[activeDayIdx]}</div>
              <div style={{fontSize:"11px",color:CN.mid}}>{dayTotals[DAYS[activeDayIdx]]>0?dayTotals[DAYS[activeDayIdx]].toFixed(1)+"h total":"No hours"}</div>
            </div>
            <button onClick={()=>setActiveDayIdx(i=>(i+1)%7)}
              style={{border:"none",background:CN.creamDark,borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:"16px",fontWeight:700,color:CN.dark}}>→</button>
          </div>

          {/* Day pills */}
          <div style={{display:"flex",gap:"6px",marginBottom:"14px",justifyContent:"center"}}>
            {DAY_LABELS.map((dl,i)=>(
              <button key={dl} onClick={()=>setActiveDayIdx(i)}
                style={{border:"none",borderRadius:"99px",padding:"4px 10px",fontSize:"11px",fontWeight:700,cursor:"pointer",
                  backgroundColor:i===activeDayIdx?CN.orange:dayTotals[DAYS[i]]>0?CN.creamDark:CN.white,
                  color:i===activeDayIdx?CN.white:dayTotals[DAYS[i]]>0?CN.dark:CN.mid,
                  border:`1px solid ${i===activeDayIdx?CN.orange:CN.border}`}}>{dl}</button>
            ))}
          </div>

          {/* Employee cards for active day */}
          {CATEGORIES.map(cat=>{
            const catRoles=grouped[cat];
            if(!catRoles.length)return null;
            const catPlans=weekPlans.filter(p=>catRoles.find(r=>r.id===p.roleId));
            if(!catPlans.length&&!catRoles.length)return null;
            return (
              <div key={cat} style={{marginBottom:"16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
                  <Tag cat={cat} small/>
                </div>
                {catRoles.map(role=>{
                  const roleRows=weekPlans.filter(p=>p.roleId===role.id);
                  const activeDay=DAYS[activeDayIdx];
                  return (
                    <div key={role.id}>
                      {roleRows.map((plan,empIdx)=>{
                        const cost=calcRowCost(role,plan.days,tax,ot);
                        const st=rowStatus(role,plan.days,ot);
                        const stStyle=STATUS[st];
                        const h=plan.days[activeDay];
                        const hNum=parseFloat(h)||0;
                        const overDay=ot?.dailyMax>0&&hNum>ot.dailyMax;
                        return (
                          <div key={plan.id} style={{backgroundColor:stStyle.rowBg,border:`1.5px solid ${overDay?CN.red:CN.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"8px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
                              <div>
                                <div style={{fontWeight:600,fontSize:"14px",color:CN.dark,display:"flex",alignItems:"center",gap:"4px"}}>
                                  {stStyle.icon&&<span>{stStyle.icon}</span>}{role.name} <span style={{fontSize:"11px",color:CN.mid,fontWeight:400}}>#{empIdx+1}</span>
                                </div>
                                <div style={{fontSize:"11px",color:CN.mid}}>{role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo`}</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:"10px",color:CN.mid}}>Week total</div>
                                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange}}>{cost.total>0?fmt$(cost.total):"—"}</div>
                              </div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                              <label style={{fontSize:"11px",fontWeight:600,color:CN.mid,textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap"}}>Hours {DAY_LABELS[activeDayIdx]}</label>
                              <input type="number" min={0} max={24} step={0.5}
                                value={h} placeholder="0"
                                onChange={e=>updateDay(plan.id,activeDay,e.target.value)}
                                style={{flex:1,textAlign:"center",border:`1.5px solid ${overDay?CN.red:CN.border}`,
                                  borderRadius:"8px",padding:"10px",fontSize:"18px",fontWeight:700,
                                  fontFamily:"'DM Sans',sans-serif",backgroundColor:overDay?"#FEE2E2":CN.white,
                                  color:overDay?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}
                              />
                              <button onClick={()=>removeRow(plan.id)}
                                style={{border:`1px solid ${CN.border}`,background:CN.white,cursor:"pointer",color:CN.mid,fontSize:"13px",padding:"8px 10px",borderRadius:"8px",lineHeight:1}}>✕</button>
                            </div>
                            <div style={{display:"flex",gap:"12px",marginTop:"8px",flexWrap:"wrap"}}>
                              <span style={{fontSize:"11px",color:CN.mid}}>Week: <strong style={{color:CN.dark}}>{cost.totalHrs>0?cost.totalHrs.toFixed(1)+"h":"—"}</strong></span>
                              {cost.otHrs>0&&<span style={{fontSize:"11px",color:CN.amberDark,fontWeight:700}}>⚡ {cost.otHrs.toFixed(1)}h OT</span>}
                            </div>
                          </div>
                        );
                      })}
                      <button onClick={()=>addRow(role.id)}
                        style={{border:`1px dashed ${CN.orange}`,background:"none",cursor:"pointer",
                          color:CN.orange,fontSize:"12px",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",
                          textTransform:"uppercase",letterSpacing:"0.06em",padding:"8px 14px",borderRadius:"8px",
                          width:"100%",marginBottom:"8px"}}>
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
      <div style={{overflowX:"auto",borderRadius:"12px",border:`1.5px solid ${CN.border}`}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px",minWidth:"860px"}}>
          <thead>
            <tr>
              <th style={{...TH,textAlign:"left",width:"170px",borderRadius:"10px 0 0 0"}}>Employee / Role</th>
              {DAY_LABELS.map(d=><th key={d} style={{...TH,textAlign:"center",width:"75px"}}>{d}</th>)}
              <th style={{...TH,textAlign:"center",width:"72px"}}>Total Hrs</th>
              <th style={{...TH,textAlign:"center",width:"68px"}}>OT Hrs</th>
              <th style={{...TH,textAlign:"right",width:"105px",borderRadius:"0 10px 0 0",paddingRight:"14px"}}>Weekly Cost</th>
            </tr>
          </thead>

          {CATEGORIES.map(cat=>{
            const catRoles=grouped[cat];
            if(!catRoles.length)return null;
            const catPlans=weekPlans.filter(p=>catRoles.find(r=>r.id===p.roleId));
            const catTotal=catPlans.reduce((s,plan)=>{
              const role=roles.find(r=>r.id===plan.roleId);
              return role?s+calcRowCost(role,plan.days,tax,ot).total:s;
            },0);

            return (
              <tbody key={cat}>
                {/* Category subheader */}
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

                {/* Employee rows */}
                {catRoles.map(role=>{
                  const roleRows=weekPlans.filter(p=>p.roleId===role.id);
                  return [
                    ...roleRows.map((plan,empIdx)=>{
                      const cost=calcRowCost(role,plan.days,tax,ot);
                      const st=rowStatus(role,plan.days,ot);
                      const stStyle=STATUS[st];
                      return (
                        <tr key={plan.id} style={{backgroundColor:stStyle.rowBg,transition:"background-color 0.2s"}}>
                          {/* Role/employee label */}
                          <td style={{...TD,padding:"8px 10px",borderLeft:"none",borderRight:`1px solid ${CN.border}`}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontWeight:600,color:CN.dark,fontSize:"12px",display:"flex",alignItems:"center",gap:"4px"}}>
                                  {stStyle.icon&&<span>{stStyle.icon}</span>}
                                  {role.name}
                                </div>
                                <div style={{fontSize:"10px",color:CN.mid}}>#{empIdx+1} · {role.payType==="Hourly"?`${fmt$(role.rate)}/hr`:`${fmt$(role.rate)}/mo`}</div>
                                {st==="ot"&&<div style={{fontSize:"10px",color:CN.amberDark,fontWeight:700}}>+{cost.otHrs.toFixed(1)}h OT this week</div>}
                                {st==="nearot"&&<div style={{fontSize:"10px",color:CN.amber,fontWeight:600}}>{(O.weeklyThreshold-cost.totalHrs).toFixed(1)}h until OT</div>}
                                {st==="daymax"&&<div style={{fontSize:"10px",color:CN.red,fontWeight:700}}>Daily max exceeded</div>}
                              </div>
                              <button onClick={()=>removeRow(plan.id)}
                                style={{border:"none",background:"none",cursor:"pointer",color:CN.border,fontSize:"13px",padding:"0",lineHeight:1,marginTop:"2px"}}
                                title="Remove row">✕</button>
                            </div>
                          </td>

                          {/* Day inputs */}
                          {DAYS.map(d=>{
                            const h=plan.days[d];
                            const hNum=parseFloat(h)||0;
                            const overDay=O.dailyMax>0&&hNum>O.dailyMax;
                            const hasHrs=hNum>0;
                            return (
                              <td key={d} style={{...TD,padding:"5px 4px"}}>
                                <input type="number" min={0} max={24} step={0.5}
                                  value={h} placeholder="–"
                                  onChange={e=>updateDay(plan.id,d,e.target.value)}
                                  style={{width:"100%",textAlign:"center",border:`1.5px solid ${overDay?CN.red:hasHrs?CN.border:CN.creamDark}`,
                                    borderRadius:"6px",padding:"6px 2px",fontSize:"13px",fontFamily:"'DM Sans',sans-serif",
                                    backgroundColor:overDay?"#FEE2E2":hasHrs?CN.white:CN.creamDark,
                                    color:overDay?CN.red:CN.dark,outline:"none",boxSizing:"border-box"}}
                                />
                              </td>
                            );
                          })}

                          {/* Row totals */}
                          <td style={{...TD,textAlign:"center",fontWeight:600,padding:"8px",color:st==="ot"||st==="nearot"?CN.amberDark:CN.dark}}>
                            {cost.totalHrs>0?cost.totalHrs.toFixed(1)+"h":"—"}
                          </td>
                          <td style={{...TD,textAlign:"center",fontWeight:cost.otHrs>0?700:400,padding:"8px",color:cost.otHrs>0?CN.amberDark:CN.mid}}>
                            {cost.otHrs>0?cost.otHrs.toFixed(1)+"h ⚡":"—"}
                          </td>
                          <td style={{...TD,textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"15px",fontWeight:700,color:CN.orange,borderRight:"none",paddingRight:"14px",padding:"8px 14px 8px 8px"}}>
                            {cost.total>0?fmt$(cost.total):"—"}
                          </td>
                        </tr>
                      );
                    }),

                    // Add-employee button row per role
                    <tr key={"add-"+role.id} style={{backgroundColor:CN.cream}}>
                      <td colSpan={11} style={{padding:"3px 8px",borderTop:`1px solid ${CN.creamDark}`}}>
                        <button onClick={()=>addRow(role.id)} style={{border:"none",background:"none",cursor:"pointer",
                          color:CN.orange,fontSize:"11px",fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",
                          textTransform:"uppercase",letterSpacing:"0.06em",padding:"5px 8px",borderRadius:"6px"}}>
                          + Add {role.name}
                        </button>
                      </td>
                    </tr>
                  ];
                })}
              </tbody>
            );
          })}

          {/* Day totals footer */}
          <tfoot>
            <tr style={{backgroundColor:CN.creamDark}}>
              <td style={{...TD,padding:"10px 12px",fontWeight:700,fontSize:"11px",textTransform:"uppercase",letterSpacing:"0.05em",color:CN.mid,borderTop:`2px solid ${CN.border}`,borderLeft:"none",borderBottom:"none"}}>
                Daily Totals
              </td>
              {DAYS.map(d=>(
                <td key={d} style={{...TD,textAlign:"center",fontWeight:700,color:CN.dark,borderTop:`2px solid ${CN.border}`,padding:"10px 4px",borderBottom:"none"}}>
                  {dayTotals[d]>0?dayTotals[d].toFixed(1)+"h":"—"}
                </td>
              ))}
              <td style={{...TD,textAlign:"center",fontWeight:800,fontFamily:"'Barlow Condensed',sans-serif",fontSize:"14px",color:CN.orange,borderTop:`2px solid ${CN.border}`,padding:"10px 8px",borderBottom:"none"}}>
                {totals.totalHrs.toFixed(1)}h
              </td>
              <td style={{...TD,textAlign:"center",fontWeight:700,color:totals.otHrs>0?CN.amberDark:CN.mid,borderTop:`2px solid ${CN.border}`,padding:"10px 8px",borderBottom:"none"}}>
                {totals.otHrs>0?totals.otHrs.toFixed(1)+"h ⚡":"—"}
              </td>
              <td style={{...TD,textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange,borderTop:`2px solid ${CN.border}`,borderRight:"none",borderBottom:"none",paddingRight:"14px",padding:"10px 14px 10px 8px"}}>
                {fmt$(totals.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      )} {/* end mobile/desktop conditional */}

      {weekPlans.length===0&&(
        <div style={{textAlign:"center",padding:"40px",color:CN.mid,marginTop:"8px"}}>
          <p style={{fontSize:"13px"}}>No employees scheduled this week. Use the <strong>+ Add [Role]</strong> buttons within each category to add rows.</p>
        </div>
      )}
    </div>
  );
}

// ── Summary Tab ───────────────────────────────────────────────────
function SummaryTab({roles,plans,tax,ot}) {
  const isMobile=useIsMobile();
  const weeks=[...new Set(plans.map(p=>p.weekOf))].sort().slice(-8);

  const weekData=(weekOf)=>{
    const r={wages:0,taxes:0,benefits:0,total:0,otHrs:0,totalHrs:0,byCategory:Object.fromEntries(CATEGORIES.map(c=>[c,0]))};
    plans.filter(p=>p.weekOf===weekOf).forEach(plan=>{
      const role=roles.find(r=>r.id===plan.roleId);
      if(!role)return;
      const c=calcRowCost(role,plan.days,tax,ot);
      r.wages+=c.wages;r.taxes+=c.taxes;r.benefits+=c.benefits;r.total+=c.total;r.otHrs+=c.otHrs;r.totalHrs+=c.totalHrs;
      r.byCategory[role.category]=(r.byCategory[role.category]||0)+c.total;
    });
    return r;
  };

  const exportCSV=()=>{
    const rows=[["Week Of","Role","Employee #","Mon","Tue","Wed","Thu","Fri","Sat","Sun","Total Hrs","OT Hrs","Wages","OT Premium","Taxes","Benefits","Total"]];
    weeks.forEach(w=>{
      const empCount={};
      plans.filter(p=>p.weekOf===w).forEach(plan=>{
        const role=roles.find(r=>r.id===plan.roleId);
        if(!role)return;
        empCount[role.id]=(empCount[role.id]||0)+1;
        const c=calcRowCost(role,plan.days,tax,ot);
        rows.push([fmtWeek(w),role.name,empCount[role.id],...DAYS.map(d=>plan.days[d]||0),c.totalHrs.toFixed(2),c.otHrs.toFixed(2),c.wages.toFixed(2),c.otPremium.toFixed(2),c.taxes.toFixed(2),c.benefits.toFixed(2),c.total.toFixed(2)]);
      });
    });
    const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    Object.assign(document.createElement("a"),{href:url,download:"headcount_plan.csv"}).click();
    URL.revokeObjectURL(url);
  };

  if(!weeks.length) return (
    <div style={{textAlign:"center",padding:"56px",color:CN.mid}}>
      <div style={{fontSize:"48px",marginBottom:"12px"}}>📊</div>
      <p>No data yet. Build a weekly schedule to see the summary.</p>
    </div>
  );

  const avg=(key)=>weeks.reduce((s,w)=>s+weekData(w)[key],0)/weeks.length;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px"}}>
        <SHead title="Labor Cost Summary" sub={`Last ${weeks.length} planned weeks · All-in employer cost`}/>
        <Btn onClick={exportCSV}>Export CSV</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:"12px",marginBottom:"20px"}}>
        {[["Avg Weekly Total",fmt$(avg("total")),CN.orange],["Avg Total Hours",avg("totalHrs").toFixed(1)+"h",CN.dark],["Avg OT Hours",avg("otHrs")>0?avg("otHrs").toFixed(1)+"h ⚡":"0h",avg("otHrs")>0?CN.amberDark:CN.mid]].map(([l,v,c])=>(
          <Card key={l} style={{textAlign:"center",padding:"16px",marginBottom:0}}>
            <div style={{fontSize:"10px",color:CN.mid,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"4px"}}>{l}</div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"28px",fontWeight:800,color:c}}>{v}</div>
          </Card>
        ))}
      </div>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px",minWidth:isMobile?"600px":"auto"}}>
          <thead>
            <tr style={{backgroundColor:CN.creamDark,borderBottom:`1px solid ${CN.border}`}}>
              {["Week","BOH","FOH","Mgmt","Wages","Taxes","Benefits","OT Hrs","Total"].map((h,i)=>(
                <th key={h} style={{padding:"10px 12px",textAlign:i===0?"left":"right",fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.mid}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w,i)=>{
              const c=weekData(w);
              return (
                <tr key={w} style={{borderBottom:i<weeks.length-1?`1px solid ${CN.creamDark}`:"none"}}>
                  <td style={{padding:"11px 12px",fontWeight:500,color:CN.dark}}>{fmtWeek(w)}</td>
                  {["BOH","FOH","Management"].map(cat=>(
                    <td key={cat} style={{padding:"11px 12px",textAlign:"right",color:CN.mid}}>{fmtK(c.byCategory[cat]||0)}</td>
                  ))}
                  <td style={{padding:"11px 12px",textAlign:"right"}}>{fmtK(c.wages)}</td>
                  <td style={{padding:"11px 12px",textAlign:"right",color:CN.mid}}>{fmtK(c.taxes)}</td>
                  <td style={{padding:"11px 12px",textAlign:"right",color:CN.mid}}>{fmtK(c.benefits)}</td>
                  <td style={{padding:"11px 12px",textAlign:"right",color:c.otHrs>0?CN.amberDark:CN.mid}}>
                    {c.otHrs>0?`${c.otHrs.toFixed(1)}h ⚡`:"—"}
                  </td>
                  <td style={{padding:"11px 12px",textAlign:"right",fontWeight:700,color:CN.orange}}>{fmt$(c.total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{borderTop:`2px solid ${CN.border}`,backgroundColor:CN.creamDark}}>
              <td style={{padding:"10px 12px",fontSize:"11px",fontWeight:700,color:CN.mid,textTransform:"uppercase"}}>Average</td>
              <td colSpan={7}/>
              <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:800,color:CN.orange}}>{fmt$(avg("total"))}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </Card>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────
function SettingsTab({tax,setTax,ot,setOt}) {
  const [t,setT]=useState({...tax});
  const [o,setO]=useState({...ot});
  const [saved,setSaved]=useState(false);
  const isMobile=useIsMobile();
  const apply=()=>{setTax(t);setOt(o);setSaved(true);setTimeout(()=>setSaved(false),2000);};

  return (
    <div>
      <SHead title="Settings" sub="Payroll tax rates and overtime rules. Verify every January — WA rates change annually."/>
      <Note>
        <strong>Why can't these pull live from WA Labor sites?</strong> Government websites block browser-to-site data requests (CORS security policy).
        Rates below are verified 2025 defaults — update them manually each January and after WA announces changes.
      </Note>
      <Card>
        <Sub>Federal Taxes — Employer Portion</Sub>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:"0 20px"}}>
          <Field label="Social Security (%)" type="number" value={t.federalSS} step={0.01} onChange={v=>setT(p=>({...p,federalSS:v}))} note={`6.2% on first $${(t.ssWageBase||176100).toLocaleString()}/yr. IRS Pub 15.`}/>
          <Field label="Medicare (%)" type="number" value={t.federalMedicare} step={0.01} onChange={v=>setT(p=>({...p,federalMedicare:v}))} note="1.45% on all wages, no cap. IRS Pub 15."/>
          <Field label="FUTA (%)" type="number" value={t.futa} step={0.01} onChange={v=>setT(p=>({...p,futa:v}))} note="Net after WA SUTA credit = 0.6%. First $7,000/employee/yr."/>
        </div>
      </Card>
      <Card>
        <Sub>Washington State — Employer Portion</Sub>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"0 20px"}}>
          <Field label="WA SUI (%)" type="number" value={t.waSUI} step={0.01} onChange={v=>setT(p=>({...p,waSUI:v}))} note={`On first $${(t.suiWageBase||72800).toLocaleString()}/yr per employee. New employer rate ~1.2%. Your experience rate: esd.wa.gov.`}/>
          <Field label="WA L&I ($/hr worked)" type="number" value={t.waLnI} step={0.01} onChange={v=>setT(p=>({...p,waLnI:v}))} note="Per hour worked. Restaurant risk class ~6901: approx $1.50–$2.50/hr. Verify at lni.wa.gov."/>
          <Field label="WA PFML Employer (%)" type="number" value={t.waPFML} step={0.01} onChange={v=>setT(p=>({...p,waPFML:v}))} note="0% for employers under 50 employees. See paidleave.wa.gov."/>
          <Field label="WA Minimum Wage ($/hr)" type="number" value={t.minWage} step={0.01} onChange={v=>setT(p=>({...p,minWage:v}))} note="$16.66/hr statewide Jan 1, 2025. Seattle large employer: $20.76. Source: lni.wa.gov."/>
        </div>
        <Field label="Rates effective date" value={t.effectiveDate||""} onChange={v=>setT(p=>({...p,effectiveDate:v}))} style={{maxWidth:"220px"}} note="Update this when you revise rates so you know when they were last checked."/>
      </Card>
      <Card>
        <Sub>Overtime Rules</Sub>
        <Note>
          WA follows federal FLSA: OT required after <strong>40 hrs/week at 1.5×</strong> for non-exempt hourly employees.
          WA has <strong>no daily OT</strong> requirement for adults (unlike CA). The daily max below is a <em>soft planning limit</em> — rows exceeding it show a 🚨 warning but no additional cost is calculated.
        </Note>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:"0 20px",maxWidth:isMobile?"100%":"500px"}}>
          <Field label="Weekly OT Threshold (hrs)" type="number" value={o.weeklyThreshold} step={1} min={1} onChange={v=>setO(p=>({...p,weeklyThreshold:v}))}/>
          <Field label="OT Multiplier" type="number" value={o.multiplier} step={0.1} min={1} onChange={v=>setO(p=>({...p,multiplier:v}))}/>
          <Field label="Daily Max (soft limit, hrs)" type="number" value={o.dailyMax} step={0.5} min={0} onChange={v=>setO(p=>({...p,dailyMax:v}))} note="Set 0 to disable."/>
        </div>
      </Card>
      <Btn onClick={apply}>{saved?"✓ Settings Saved":"Save Settings"}</Btn>
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]=useState("plan");
  const [roles,setRoles]=useState(null);
  const [plans,setPlans]=useState(null);
  const [tax,setTax]=useState(null);
  const [ot,setOt]=useState(null);
  const [loading,setLoading]=useState(true);
  const [logoUrl,setLogoUrl]=useState(null);
  const [tabIcons,setTabIcons]=useState(DEFAULT_TAB_ICONS);
  const [showSystemTools,setShowSystemTools]=useState(false);
  const isMobile=useIsMobile();

  useEffect(()=>{
    const link=document.createElement("link");
    link.rel="stylesheet";
    link.href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    document.body.style.margin="0";document.body.style.padding="0";document.body.style.backgroundColor=CN.cream;
  },[]);

  useEffect(()=>{
    (async()=>{
      setRoles(await loadS(SK.roles,null)||DEFAULT_ROLES.map(r=>({...r,benefits:{...DEFAULT_BENEFITS,...(r.benefits||{})}})));
      setPlans(await loadS(SK.plans,[]));
      setTax(await loadS(SK.tax,DEFAULT_TAX));
      setOt(await loadS(SK.ot,DEFAULT_OT));
      const savedIcons=await loadS(SK.icons,DEFAULT_TAB_ICONS);
      setTabIcons({...DEFAULT_TAB_ICONS,...savedIcons});
      const savedLogo=await loadS(SK.logo,null);
      if(savedLogo) setLogoUrl(savedLogo);
      setLoading(false);
    })();
  },[]);

  useEffect(()=>{if(roles)saveS(SK.roles,roles);},[roles]);
  useEffect(()=>{if(plans)saveS(SK.plans,plans);},[plans]);
  useEffect(()=>{if(tax)saveS(SK.tax,tax);},[tax]);
  useEffect(()=>{if(ot)saveS(SK.ot,ot);},[ot]);
  useEffect(()=>{saveS(SK.icons,tabIcons);},[tabIcons]);
  useEffect(()=>{if(logoUrl)saveS(SK.logo,logoUrl);},[logoUrl]);

  const TABS=[
    {id:"roles",label:"Job Roles",icon:tabIcons.roles},
    {id:"plan",label:"Schedule",icon:tabIcons.plan},
    {id:"summary",label:"Summary",icon:tabIcons.summary},
    {id:"settings",label:"Settings",icon:"⚙️"},
  ];

  if(loading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",backgroundColor:CN.cream}}>
      <div style={{color:CN.mid,fontSize:"14px",fontFamily:"sans-serif"}}>Loading...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",backgroundColor:CN.cream,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:`linear-gradient(135deg,${CN.orange} 0%,#FF5722 100%)`,padding:isMobile?"10px 14px":"14px 24px",boxShadow:"0 2px 12px rgba(244,58,10,0.25)"}}>
        <div style={{maxWidth:"1100px",margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>

          {/* Logo + Title */}
          <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
            <div
              onClick={()=>document.getElementById("cn-logo-upload").click()}
              title="Click to upload your logo"
              style={{width:isMobile?36:52,height:isMobile?36:52,borderRadius:8,border:"2px dashed rgba(255,255,255,0.5)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",backgroundColor:"rgba(255,255,255,0.12)",flexShrink:0,transition:"background 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.backgroundColor="rgba(255,255,255,0.22)"}
              onMouseLeave={e=>e.currentTarget.style.backgroundColor="rgba(255,255,255,0.12)"}
            >
              {logoUrl
                ? <img src={logoUrl} alt="Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                : <span style={{fontSize:isMobile?"16px":"22px",opacity:0.65}}>🏢</span>
              }
            </div>
            <input id="cn-logo-upload" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
              const file=e.target.files[0];
              if(!file) return;
              const reader=new FileReader();
              reader.onload=ev=>setLogoUrl(ev.target.result);
              reader.readAsDataURL(file);
              e.target.value="";
            }}/>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:isMobile?"16px":"22px",letterSpacing:"0.08em",textTransform:"uppercase",color:CN.white,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {isMobile?"CN · Headcount":"Cheeky Noodles · Headcount Planner"}
              </div>
              {!isMobile&&<div style={{fontSize:"11px",color:"rgba(255,255,255,0.75)",marginTop:"2px"}}>Standalone labor planning tool · Data persists between sessions</div>}
            </div>
          </div>

          {/* Stats + System Tools */}
          <div style={{display:"flex",alignItems:"center",gap:isMobile?8:16,flexShrink:0}}>
            {!isMobile&&<div style={{textAlign:"right",fontSize:"12px",color:"rgba(255,255,255,0.8)"}}>
              <div>{(roles||[]).filter(r=>r.active).length} active roles</div>
              <div>{[...new Set((plans||[]).map(p=>p.weekOf))].length} weeks planned</div>
            </div>}

            {/* System Tools button + dropdown */}
            <div style={{position:"relative"}}>
              <button
                onClick={()=>setShowSystemTools(v=>!v)}
                style={{background:"rgba(255,255,255,0.18)",border:"1px solid rgba(255,255,255,0.38)",borderRadius:8,padding:"7px 13px",color:CN.white,cursor:"pointer",fontSize:"13px",fontWeight:600,fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}
              >🛠️ System Tools</button>

              {showSystemTools && (
                <>
                  {/* Click-outside overlay */}
                  <div style={{position:"fixed",inset:0,zIndex:999}} onClick={()=>setShowSystemTools(false)}/>

                  {/* Dropdown panel */}
                  <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:310,backgroundColor:CN.white,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.18)",border:`1px solid ${CN.border}`,zIndex:1000,overflow:"hidden"}}>
                    <div style={{padding:"11px 16px",backgroundColor:CN.creamDark,borderBottom:`1px solid ${CN.border}`,fontWeight:700,fontSize:"13px",color:CN.dark,fontFamily:"'DM Sans',sans-serif"}}>
                      🛠️ System Tools
                    </div>

                    {/* Logo section */}
                    <div style={{padding:"14px 16px",borderBottom:`1px solid ${CN.border}`}}>
                      <div style={{fontSize:"11px",fontWeight:600,color:CN.mid,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Logo</div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:44,height:44,borderRadius:6,border:`1px solid ${CN.border}`,overflow:"hidden",backgroundColor:CN.creamDark,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {logoUrl
                            ? <img src={logoUrl} alt="Logo" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
                            : <span style={{fontSize:"20px",opacity:0.4}}>🏢</span>
                          }
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <button
                            onClick={()=>document.getElementById("cn-logo-upload").click()}
                            style={{fontSize:"12px",padding:"5px 10px",borderRadius:6,border:`1px solid ${CN.border}`,backgroundColor:CN.white,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",color:CN.dark,display:"block",width:"100%",marginBottom:4}}
                          >{logoUrl?"Replace logo":"Upload logo"}</button>
                          {logoUrl && (
                            <button
                              onClick={()=>setLogoUrl(null)}
                              style={{fontSize:"11px",padding:"4px 10px",borderRadius:6,border:`1px solid ${CN.border}`,backgroundColor:CN.white,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",color:CN.red,display:"block",width:"100%"}}
                            >Remove logo</button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Navigation Icons section */}
                    <div style={{padding:"14px 16px"}}>
                      <div style={{fontSize:"11px",fontWeight:600,color:CN.mid,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Navigation Icons</div>
                      {[
                        {id:"roles",   label:"Job Roles",       options:["👥","👤","🧑‍💼","👷","🧑‍🍳","🤝","🏢","🎭"]},
                        {id:"plan",    label:"Weekly Schedule",  options:["📋","📅","🗓️","📆","🗒️","📝","⏰","🗂️"]},
                        {id:"summary", label:"Summary",          options:["📊","📈","📉","💼","🧾","📄","💰","🔍"]},
                      ].map(row=>(
                        <div key={row.id} style={{marginBottom:12}}>
                          <div style={{fontSize:"12px",color:CN.dark,marginBottom:6,fontWeight:500,fontFamily:"'DM Sans',sans-serif"}}>{row.label}</div>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            {row.options.map(icon=>(
                              <button
                                key={icon}
                                onClick={()=>setTabIcons(prev=>({...prev,[row.id]:icon}))}
                                style={{fontSize:"17px",padding:"4px 7px",borderRadius:6,border:tabIcons[row.id]===icon?`2px solid ${CN.orange}`:"2px solid transparent",backgroundColor:tabIcons[row.id]===icon?CN.orangeLight:"transparent",cursor:"pointer",lineHeight:1.3}}
                              >{icon}</button>
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
      <div style={{backgroundColor:CN.white,borderBottom:`1.5px solid ${CN.border}`}}>
        <div style={{maxWidth:"1100px",margin:"0 auto",display:"flex",overflowX:"auto"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:isMobile?"10px 14px":"12px 22px",fontSize:isMobile?"12px":"13px",fontWeight:600,border:"none",cursor:"pointer",borderBottom:tab===t.id?`3px solid ${CN.orange}`:"3px solid transparent",color:tab===t.id?CN.orange:CN.mid,backgroundColor:"transparent",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{maxWidth:"1100px",margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>
        {tab==="roles"    &&<RolesTab    roles={roles}  setRoles={setRoles}  tax={tax} ot={ot}/>}
        {tab==="plan"     &&<PlanTab     roles={roles}  plans={plans}  setPlans={setPlans} tax={tax} ot={ot}/>}
        {tab==="summary"  &&<SummaryTab  roles={roles}  plans={plans}  tax={tax} ot={ot}/>}
        {tab==="settings" &&<SettingsTab tax={tax} setTax={setTax} ot={ot} setOt={setOt}/>}
      </div>
    </div>
  );
}