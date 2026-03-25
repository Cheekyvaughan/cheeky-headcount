// ── Store Setup — FP&A Phase 1 ─────────────────────────────────────
// Exports: StoreSetupTab, DEFAULT_STORE, AdminPeriodSetup, DEFAULT_PERIODS
// Storage keys:
//   SHARED: cn-stores-v1, cn-forecast-periods-v1

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

const CN = {
  orange:"#FF3C00", orangeHover:"#D93200", orangeLight:"#FFEDE8",
  cream:"#FBF5DF", creamDark:"#EFE7C8", dark:"#3C3C37", mid:"#494843",
  border:"#EAE6E5", white:"#FFFFFF", amber:"#F0B030", amberLight:"#FFF5CC", amberDark:"#C88800",
  red:"#CC2800", redLight:"#FFE0D8", blue:"#09A387", blueLight:"#D0EFE8",
  green:"#078A72", greenLight:"#D0EFE8",
};
const FH = "'Bowlby One SC', sans-serif";
const FB = "'Barlow Semi Condensed', sans-serif";

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }
function uid() { return Math.random().toString(36).slice(2,9)+Date.now().toString(36); }
function fmtDate(s) { if(!s)return"—"; const d=new Date(s+"T00:00:00"); return isNaN(d)?s:d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
function addWeeks(d,w) { if(!d)return""; const dt=new Date(d+"T00:00:00"); dt.setDate(dt.getDate()+w*7); return dt.toISOString().split("T")[0]; }

const WORKER="https://cheeky-headcount-proxy.vaughan-184.workers.dev";
const SEASON_MONTHS={Winter:[11,0,1],Spring:[2,3,4],Summer:[5,6,7],Fall:[8,9,10]};
const SEASON_CLR={Winter:{bg:"#E8F0FF",text:"#3B5BDB",border:"#BAC8FF"},Spring:{bg:"#EBFBEE",text:"#2F9E44",border:"#B2F2BB"},Summer:{bg:"#FFF9DB",text:"#E67700",border:"#FFE066"},Fall:{bg:CN.orangeLight,text:CN.orangeHover,border:"#FFBFA8"}};
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const ACQL=["Low","Mid","High"];
const ACLR={Low:CN.blue,Mid:CN.amber,High:CN.green};
const ACBG={Low:CN.blueLight,Mid:CN.amberLight,High:CN.greenLight};
function getSeason(m){for(const[s,ms]of Object.entries(SEASON_MONTHS))if(ms.includes(m))return s;return"Winter";}
function fmtHrs(o,c){if(!o||!c)return"—";const[oh,om]=o.split(":").map(Number);const[ch,cm]=c.split(":").map(Number);const m=(ch*60+cm)-(oh*60+om);return m>0?(m/60).toFixed(1)+"h":"—";}

export const DEFAULT_PERIODS={months:36};
export const DEFAULT_STORE={
  id:null,name:"",address:"",website:"",description:"",
  timeline:{handoverDate:"",constructionWeeks:16,softOpenDate:"",hardOpenDate:""},
  schedule:{weekday:{open:"12:00",close:"21:00",closed:false},saturday:{open:"12:00",close:"20:00",closed:false},sunday:{open:"12:00",close:"20:00",closed:false},exceptions:{}},
  holidaysPerYear:6,
  seasonality:{Winter:1.00,Spring:0.85,Summer:0.80,Fall:0.95},
  aiSeasonality:null,
  acquisitionProfiles:{Low:{baseTransactions:1854},Mid:{baseTransactions:2780},High:{baseTransactions:3706}},
  aiAcquisition:null,
  growthProfiles:{
    Low:{label:"Low Growth",rampRates:[0,0.30,0.25,0.20,0.15,0.10,0.08,0.06,0.05,0.04,0.03,0.02],stabilisedRate:0.003},
    Mid:{label:"Mid Growth",rampRates:[0,0.50,0.44,0.32,0.24,0.14,0.125,0.08,0.07,0.045,0.03,0.03],stabilisedRate:0.003},
    High:{label:"High Growth",rampRates:[0,0.70,0.60,0.45,0.32,0.20,0.15,0.12,0.10,0.07,0.05,0.04],stabilisedRate:0.003},
  },
  aiGrowth:null,
  scenarios:[
    {id:"s1",acquisition:"Low",growth:"Low",name:"Scenario 1",active:true,isBase:true},
    {id:"s2",acquisition:"Low",growth:"Mid",name:"Scenario 2",active:true,isBase:false},
    {id:"s3",acquisition:"Low",growth:"High",name:"Scenario 3",active:true,isBase:false},
    {id:"s4",acquisition:"Mid",growth:"Low",name:"Scenario 4",active:true,isBase:false},
    {id:"s5",acquisition:"Mid",growth:"Mid",name:"Scenario 5",active:true,isBase:false},
    {id:"s6",acquisition:"Mid",growth:"High",name:"Scenario 6",active:true,isBase:false},
    {id:"s7",acquisition:"High",growth:"Low",name:"Scenario 7",active:true,isBase:false},
    {id:"s8",acquisition:"High",growth:"Mid",name:"Scenario 8",active:true,isBase:false},
    {id:"s9",acquisition:"High",growth:"High",name:"Scenario 9",active:true,isBase:false},
  ],
  setupComplete:false,
};

const SECTIONS=["about","timeline","schedule","seasonality","acquisition","growth","scenarios"];
function isSectionComplete(store,id){
  if(!store)return false;
  if(id==="about")return!!(store.name?.trim()&&store.address?.trim());
  if(id==="timeline")return!!(store.timeline?.handoverDate&&store.timeline?.hardOpenDate);
  if(id==="schedule")return true;
  if(id==="seasonality")return Object.values(store.seasonality||{}).every(v=>v>0);
  if(id==="scenarios")return store.scenarios?.some(s=>s.isBase&&s.active);
  if(id==="acquisition")return ACQL.every(k=>store.acquisitionProfiles?.[k]?.baseTransactions>0);
  if(id==="growth")return ACQL.every(k=>store.growthProfiles?.[k]?.rampRates?.length>=12);
  return false;
}
function canAccess(store,id){const i=SECTIONS.indexOf(id);if(i<=0)return true;return SECTIONS.slice(0,i).every(s=>isSectionComplete(store,s));}

// ── Primitives ────────────────────────────────────────────────────
const INP={border:`1.5px solid ${CN.border}`,borderRadius:8,padding:"9px 12px",fontSize:15,fontFamily:FB,color:CN.dark,backgroundColor:CN.white,outline:"none",boxSizing:"border-box",width:"100%"};
function Lbl({children,required}){return<label style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:CN.mid,display:"block",marginBottom:5,fontFamily:FB}}>{children}{required&&<span style={{color:CN.orange,marginLeft:3}}>*</span>}</label>;}
function FG({label,note,required,children,style={}}){return<div style={{marginBottom:16,...style}}>{label&&<Lbl required={required}>{label}</Lbl>}{children}{note&&<div style={{fontSize:13,color:CN.mid,marginTop:4,fontFamily:FB,lineHeight:1.5}}>{note}</div>}</div>;}
function InfoBox({children,type="info"}){const s={info:{bg:CN.creamDark,border:CN.border,text:CN.mid},warning:{bg:CN.amberLight,border:CN.amber,text:"#92400E"},success:{bg:CN.greenLight,border:CN.green,text:CN.green},alert:{bg:CN.orangeLight,border:CN.orange,text:CN.orangeHover}}[type]||{};return<div style={{backgroundColor:s.bg,border:`1px solid ${s.border}`,borderRadius:8,padding:"10px 14px",fontSize:14,color:s.text,marginBottom:14,fontFamily:FB,lineHeight:1.5}}>{children}</div>;}

// Inline suggestion box — shows below input fields when AI has a proposal
function SuggestionBox({label,rows,onApply,onDismiss,generatedAt}){
  return(
    <div style={{marginTop:12,border:`2px solid ${CN.orange}`,borderRadius:10,backgroundColor:CN.orangeLight,overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 14px",borderBottom:`1px solid ${CN.orange}30`,backgroundColor:"rgba(255,60,0,0.08)"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:14}}>✨</span>
          <span style={{fontFamily:FH,fontSize:12,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.orange}}>AI Suggestion</span>
          {generatedAt&&<span style={{fontSize:11,color:CN.orangeHover,fontFamily:FB}}>· saved {fmtDate(generatedAt.split("T")[0])}</span>}
        </div>
        <button onClick={onDismiss} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:CN.orangeHover,fontFamily:FB,padding:"2px 4px"}} title="Dismiss suggestion">✕</button>
      </div>
      <div style={{padding:"12px 14px"}}>
        <div style={{display:"grid",gap:6,marginBottom:12}}>
          {rows.map(r=>(
            <div key={r.label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",backgroundColor:"rgba(255,60,0,0.06)",borderRadius:7,border:`1px solid ${CN.orange}20`}}>
              <span style={{fontSize:14,color:CN.dark,fontFamily:FB,fontWeight:600}}>{r.label}</span>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {r.current!==undefined&&<span style={{fontSize:12,color:CN.mid,fontFamily:FB,textDecoration:"line-through"}}>{r.current}</span>}
                <span style={{fontSize:15,fontWeight:800,color:CN.orange,fontFamily:FH}}>{r.suggested}</span>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onApply} style={{
          width:"100%",padding:"9px",borderRadius:8,border:"none",
          backgroundColor:CN.orange,color:CN.white,fontFamily:FH,
          fontWeight:700,fontSize:13,textTransform:"uppercase",
          letterSpacing:"0.06em",cursor:"pointer",
        }}>Apply These Values →</button>
      </div>
    </div>
  );
}

// Saved AI narrative — shown in completed setup view
function AiNarrativeCard({aiData,label}){
  const[open,setOpen]=useState(false);
  if(!aiData?.history?.length)return null;
  const lastMsg=[...aiData.history].reverse().find(m=>m.role==="assistant");
  if(!lastMsg)return null;
  const preview=lastMsg.content.replace(/```json[\s\S]*?```/g,"").trim().slice(0,160)+"…";
  return(
    <div style={{marginTop:14,border:`1px solid ${CN.orange}30`,borderRadius:10,backgroundColor:"rgba(255,60,0,0.03)",overflow:"hidden"}}>
      <button onClick={()=>setOpen(v=>!v)} style={{
        width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"10px 14px",background:"none",border:"none",cursor:"pointer",textAlign:"left",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:14}}>✨</span>
          <span style={{fontFamily:FH,fontSize:12,textTransform:"uppercase",letterSpacing:"0.07em",color:CN.orange}}>{label||"AI Analysis"}</span>
          <span style={{fontSize:11,color:CN.mid,fontFamily:FB}}>· saved {fmtDate(aiData.generatedAt?.split("T")[0])}</span>
        </div>
        <span style={{fontSize:12,color:CN.mid}}>{open?"▲":"▼"}</span>
      </button>
      {!open&&<div style={{padding:"0 14px 12px",fontSize:13,color:CN.mid,fontFamily:FB,lineHeight:1.5}}>{preview}</div>}
      {open&&(
        <div style={{padding:"0 14px 14px",fontSize:13,color:CN.dark,fontFamily:FB,lineHeight:1.7,whiteSpace:"pre-wrap",borderTop:`1px solid ${CN.orange}20`}}>
          {lastMsg.content.replace(/```json[\s\S]*?```/g,"").trim()}
          {aiData.history.filter(m=>m.role==="user").length>1&&(
            <div style={{marginTop:12,fontSize:12,color:CN.mid,fontFamily:FB}}>
              {aiData.history.filter(m=>m.role==="user").length-1} follow-up question{aiData.history.filter(m=>m.role==="user").length>2?"s":""} in this conversation.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function Btn({onClick,children,variant="primary",style={},disabled=false}){
  const base={border:"none",borderRadius:8,padding:"9px 20px",fontSize:14,fontWeight:700,cursor:disabled?"not-allowed":"pointer",fontFamily:FH,textTransform:"uppercase",letterSpacing:"0.06em",transition:"all 0.15s",opacity:disabled?0.4:1};
  const v={primary:{...base,backgroundColor:CN.orange,color:CN.white},secondary:{...base,backgroundColor:CN.creamDark,color:CN.dark},danger:{...base,backgroundColor:CN.red,color:CN.white},ai:{...base,backgroundColor:"#1a1a2e",color:"#a8d5e2",display:"flex",alignItems:"center",gap:7}};
  return<button onClick={onClick} disabled={disabled} style={{...( v[variant]||v.primary),...style}}>{children}</button>;
}
function SectionCard({num,title,subtitle,complete,locked,children}){
  return(
    <div style={{backgroundColor:CN.white,border:`1.5px solid ${locked?CN.border:complete?CN.green:CN.border}`,borderRadius:14,overflow:"hidden",marginBottom:24,opacity:locked?0.5:1,pointerEvents:locked?"none":"auto"}}>
      <div style={{padding:"16px 22px",borderBottom:`1px solid ${CN.border}`,backgroundColor:CN.cream,display:"flex",alignItems:"flex-start",gap:12}}>
        <div style={{width:34,height:34,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,backgroundColor:complete?CN.green:locked?CN.creamDark:CN.orange,color:locked?CN.mid:CN.white,fontFamily:FH}}>{complete?"✓":locked?"🔒":num}</div>
        <div>
          <div style={{fontFamily:FH,fontWeight:800,fontSize:18,textTransform:"uppercase",letterSpacing:"0.06em",color:locked?CN.mid:CN.dark}}>{title}</div>
          {subtitle&&<div style={{fontSize:13,color:CN.mid,marginTop:3,fontFamily:FB}}>{subtitle}</div>}
        </div>
      </div>
      <div style={{padding:22}}>{children}</div>
    </div>
  );
}

// ── Chat panel (fixed drawer — no layout impact) ──────────────────
// Renders outside the form flow so it never causes horizontal scroll.
// Each AI section owns its own history via the savedHistory prop.
function ChatPanel({ title, systemPrompt, savedHistory, onSaveHistory, onClose, missingContext }) {
  const [messages, setMessages] = useState(() => savedHistory?.length ? savedHistory : []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Auto-generate opening message on first open
  useEffect(() => {
    if (!missingContext && messages.length === 0 && systemPrompt) {
      sendMessage(systemPrompt, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = async (content, isSystem = false) => {
    if (!content.trim()) return;
    const userMsg = { role: "user", content: isSystem ? content : content.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    if (!isSystem) setInput("");
    setLoading(true);
    setError("");
    try {
      const token = await window._clerkGetToken?.();
      if (!token) throw new Error("Not signed in — please refresh.");
      const res = await fetch(`${WORKER}/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, messages: newMessages }),
      });
      if (!res.ok) {
        const t = await res.text();
        let m = `Error ${res.status}`;
        try { m = JSON.parse(t)?.error?.message || m; } catch {}
        throw new Error(m);
      }
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const withReply = [...newMessages, { role: "assistant", content: text }];
      setMessages(withReply);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    onSaveHistory(messages);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDownload = () => {
    const lines = [];
    lines.push(`# ${title}`);
    lines.push(`_Downloaded ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}_\n`);
    messages.forEach((m, i) => {
      if (m.role === "user" && i === 0) return; // skip system prompt
      if (m.role === "user") {
        lines.push(`---\n**You:** ${m.content}\n`);
      } else {
        lines.push(`**Claude:** ${m.content.replace(/```json[\s\S]*?```/g,"").trim()}\n`);
      }
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g,"-")}-analysis.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");

  return (
    <>
      {/* Backdrop on mobile */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1099, backgroundColor: "rgba(0,0,0,0.25)" }} />
      {/* Drawer */}
      <div style={{
        position: "fixed", right: 0, top: 0, bottom: 0, zIndex: 1100,
        width: "min(440px, 92vw)",
        backgroundColor: CN.white,
        borderLeft: `1.5px solid ${CN.border}`,
        boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 18px", borderBottom: `1px solid ${CN.border}`,
          backgroundColor: "#1a1a2e", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <div>
              <div style={{ fontFamily: FH, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "#a8d5e2" }}>{title}</div>
              <div style={{ fontSize: 12, color: "rgba(168,213,226,0.55)", fontFamily: FB }}>Claude · Ask follow-up questions</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "rgba(255,255,255,0.5)", lineHeight: 1, padding: "4px" }}>✕</button>
        </div>

        {/* Missing context warning */}
        {missingContext && (
          <div style={{ padding: "14px 18px", backgroundColor: CN.amberLight, borderBottom: `1px solid ${CN.amber}`, flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: "#92400E", fontFamily: FB, lineHeight: 1.5 }}>
              ⚠️ {missingContext}
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.length === 0 && !loading && !missingContext && (
            <div style={{ textAlign: "center", padding: "32px 16px", color: CN.mid }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
              <div style={{ fontSize: 14, fontFamily: FB, lineHeight: 1.5 }}>Generating analysis…</div>
            </div>
          )}
          {messages.filter(m => m.role === "assistant" || (m.role === "user" && messages.indexOf(m) > 0)).map((msg, i) => {
            // Only show user messages that are follow-ups (not the system prompt)
            const isUser = msg.role === "user";
            if (isUser && i === 0) return null;
            return (
              <div key={i} style={{
                display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "88%",
                  padding: "10px 14px",
                  borderRadius: isUser ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                  backgroundColor: isUser ? CN.orange : CN.creamDark,
                  color: isUser ? CN.white : CN.dark,
                  fontSize: 14, fontFamily: FB, lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {msg.content.replace(/```json[\s\S]*?```/g, "").trim()}
                </div>
              </div>
            );
          })}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "10px 14px", borderRadius: "4px 14px 14px 14px", backgroundColor: CN.creamDark }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 7, height: 7, borderRadius: "50%", backgroundColor: CN.mid,
                      animation: `pulse ${0.6 + i * 0.2}s ease-in-out infinite alternate`,
                    }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, backgroundColor: CN.redLight, color: CN.red, fontSize: 13, fontFamily: FB }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Save + Download buttons */}
        {lastAssistant && (
          <div style={{ padding: "10px 18px", borderTop: `1px solid ${CN.border}`, flexShrink: 0, backgroundColor: CN.cream, display:"flex", gap:8 }}>
            <button onClick={handleSave} style={{
              flex:1, padding: "9px 16px", borderRadius: 8, border: "none",
              backgroundColor: saved ? CN.green : CN.orange,
              color: CN.white, fontFamily: FH, fontWeight: 700, fontSize: 12,
              textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
              transition: "background 0.3s",
            }}>
              {saved ? "✓ Saved" : "Save to Setup"}
            </button>
            <button onClick={handleDownload} title="Download as Markdown" style={{
              flexShrink:0, padding:"9px 13px", borderRadius:8,
              border:`1.5px solid ${CN.border}`, backgroundColor:CN.white,
              color:CN.mid, cursor:"pointer", fontSize:16, lineHeight:1,
            }}>⬇</button>
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: "12px 18px 16px", borderTop: `1px solid ${CN.border}`,
          flexShrink: 0, backgroundColor: CN.white,
          display: "flex", gap: 8, alignItems: "flex-end",
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!loading && input.trim()) sendMessage(input); } }}
            placeholder="Ask a follow-up question… (Enter to send)"
            disabled={loading || !!missingContext}
            rows={2}
            style={{
              flex: 1, border: `1.5px solid ${CN.border}`, borderRadius: 10,
              padding: "9px 12px", fontSize: 14, fontFamily: FB, color: CN.dark,
              backgroundColor: CN.white, outline: "none", resize: "none",
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => !loading && input.trim() && sendMessage(input)}
            disabled={loading || !input.trim() || !!missingContext}
            style={{
              padding: "9px 16px", borderRadius: 10, border: "none",
              backgroundColor: CN.orange, color: CN.white, cursor: "pointer",
              fontFamily: FH, fontWeight: 700, fontSize: 13, flexShrink: 0,
              opacity: loading || !input.trim() ? 0.4 : 1,
              alignSelf: "flex-end",
            }}
          >↑</button>
        </div>
      </div>
      <style>{`@keyframes pulse { from { opacity: 0.3; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }`}</style>
    </>
  );
}

// ── Calendar schedule ─────────────────────────────────────────────
function ScheduleCalendar({schedule,onChange}){
  const[vm,setVm]=useState(()=>{const n=new Date();return{y:n.getFullYear(),m:n.getMonth()};});
  const[sel,setSel]=useState(null);
  const[ef,setEf]=useState({closed:false,open:"",close:""});
  const{y,m}=vm;
  const firstDow=new Date(y,m,1).getDay();
  const dim=new Date(y,m+1,0).getDate();
  const dk=(d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const ddow=(d)=>new Date(y,m,d).getDay();
  const defForDow=(dow)=>dow===0?schedule.sunday:dow===6?schedule.saturday:schedule.weekday;
  const status=(d)=>{const exc=schedule.exceptions?.[dk(d)];if(exc)return exc.closed?"exc-closed":"exc-custom";return defForDow(ddow(d))?.closed?"def-closed":"def-open";};
  const clr={"def-open":{bg:CN.blueLight,border:"transparent",text:CN.dark},"def-closed":{bg:CN.creamDark,border:"transparent",text:CN.mid},"exc-closed":{bg:CN.redLight,border:CN.red,text:CN.red},"exc-custom":{bg:"#F0FFF4",border:CN.green,text:CN.green}};
  const openExc=(d)=>{const exc=schedule.exceptions?.[dk(d)];setEf(exc?{closed:!!exc.closed,open:exc.open||"",close:exc.close||""}:{closed:!!defForDow(ddow(d))?.closed,open:defForDow(ddow(d))?.open||"",close:defForDow(ddow(d))?.close||""});setSel(d);};
  const saveExc=()=>{const key=dk(sel);const exc=ef.closed?{closed:true}:{open:ef.open,close:ef.close};onChange({...schedule,exceptions:{...(schedule.exceptions||{}),[key]:exc}});setSel(null);};
  const clearExc=()=>{const key=dk(sel);const{[key]:_,...rest}=schedule.exceptions||{};onChange({...schedule,exceptions:rest});setSel(null);};
  return(
    <div>
      {/* Standard template — stacked layout, no horizontal overflow */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:18}}>
        {[{k:"weekday",l:"Mon – Fri"},{k:"saturday",l:"Saturday"},{k:"sunday",l:"Sunday"}].map(({k,l})=>{
          const row=schedule[k]||{};
          return(
            <div key={k} style={{backgroundColor:row.closed?CN.creamDark:CN.blueLight,border:`1.5px solid ${row.closed?CN.border:CN.blue}`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontWeight:700,fontSize:15,color:CN.dark,fontFamily:FB}}>{l}</span>
                <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:13,color:CN.mid,fontFamily:FB}}>
                  <input type="checkbox" checked={!!row.closed} onChange={e=>onChange({...schedule,[k]:{...row,closed:e.target.checked}})} style={{accentColor:CN.orange}}/>
                  Closed
                </label>
              </div>
              {!row.closed&&(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12,color:CN.mid,fontFamily:FB,width:36,flexShrink:0}}>Opens</span>
                    <input type="time" value={row.open||""} onChange={e=>onChange({...schedule,[k]:{...row,open:e.target.value}})} style={{...INP,fontSize:14,padding:"6px 8px"}}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12,color:CN.mid,fontFamily:FB,width:36,flexShrink:0}}>Closes</span>
                    <input type="time" value={row.close||""} onChange={e=>onChange({...schedule,[k]:{...row,close:e.target.value}})} style={{...INP,fontSize:14,padding:"6px 8px"}}/>
                  </div>
                  <div style={{fontSize:14,fontWeight:700,color:CN.orange,fontFamily:FH,textAlign:"right"}}>{fmtHrs(row.open,row.close)}</div>
                </div>
              )}
              {row.closed&&<div style={{fontSize:13,color:CN.mid,fontFamily:FB,marginTop:4}}>Not trading</div>}
            </div>
          );
        })}
      </div>
      <InfoBox>Click any calendar day to override it — e.g. a public holiday, early close, or special event. Red = closed · Green = custom hours · Blue = standard open.</InfoBox>
      {/* Calendar */}
      <div style={{backgroundColor:CN.creamDark,borderRadius:12,padding:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <button onClick={()=>setVm(v=>{const nm=v.m-1;return nm<0?{y:v.y-1,m:11}:{y:v.y,m:nm};})} style={{border:"none",background:CN.white,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:FB,fontSize:14,color:CN.dark}}>←</button>
          <span style={{fontFamily:FH,fontSize:16,fontWeight:800,color:CN.dark,textTransform:"uppercase",letterSpacing:"0.06em"}}>{MN[m]} {y}</span>
          <button onClick={()=>setVm(v=>{const nm=v.m+1;return nm>11?{y:v.y+1,m:0}:{y:v.y,m:nm};})} style={{border:"none",background:CN.white,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:FB,fontSize:14,color:CN.dark}}>→</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {DOW.map(d=><div key={d} style={{textAlign:"center",fontSize:12,fontWeight:700,color:CN.mid,textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:FB}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {Array.from({length:firstDow}).map((_,i)=><div key={`e${i}`}/>)}
          {Array.from({length:dim}).map((_,i)=>{const d=i+1,st=status(d),c=clr[st],isSel=sel===d,hasExc=!!(schedule.exceptions?.[dk(d)]);return(
            <button key={d} onClick={()=>openExc(d)} style={{border:`1.5px solid ${isSel?CN.orange:c.border}`,borderRadius:7,padding:"5px 2px",cursor:"pointer",backgroundColor:isSel?CN.orangeLight:c.bg,color:c.text,fontSize:14,fontWeight:hasExc?700:400,fontFamily:FB,textAlign:"center",lineHeight:1.2,transition:"all 0.1s",position:"relative"}}>
              {d}{hasExc&&<div style={{width:4,height:4,borderRadius:"50%",backgroundColor:c.text,margin:"2px auto 0"}}/>}
            </button>
          );})}
        </div>
      </div>
      {/* Exception editor */}
      {sel!==null&&(
        <div style={{marginTop:12,backgroundColor:CN.white,border:`1.5px solid ${CN.orange}`,borderRadius:10,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:FH,fontSize:16,fontWeight:800,color:CN.dark,textTransform:"uppercase"}}>{MN[m]} {sel}</span>
            {schedule.exceptions?.[dk(sel)]&&<button onClick={clearExc} style={{fontSize:13,color:CN.red,background:"none",border:"none",cursor:"pointer",fontFamily:FB,fontWeight:700}}>Remove exception</button>}
          </div>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:10,fontSize:14,fontFamily:FB}}>
            <input type="checkbox" checked={ef.closed} onChange={e=>setEf(p=>({...p,closed:e.target.checked}))} style={{accentColor:CN.red,width:16,height:16}}/>
            <span style={{color:CN.red,fontWeight:600}}>Closed this day</span>
          </label>
          {!ef.closed&&(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input type="time" value={ef.open} onChange={e=>setEf(p=>({...p,open:e.target.value}))} style={{...INP,fontSize:14}}/>
              <span style={{color:CN.mid}}>–</span>
              <input type="time" value={ef.close} onChange={e=>setEf(p=>({...p,close:e.target.value}))} style={{...INP,fontSize:14}}/>
            </div>
          )}
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <Btn onClick={saveExc}>Save</Btn>
            <Btn variant="secondary" onClick={()=>setSel(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Operating calendar ────────────────────────────────────────────
function OpCalendar({store,periods}){
  const openDate=store.timeline?.hardOpenDate;
  const months=useMemo(()=>{
    if(!openDate)return[];
    const open=new Date(openDate+"T00:00:00");
    if(isNaN(open.getTime()))return[];
    const total=periods?.months||36,result=[];
    for(let i=0;i<total;i++){
      const d=new Date(open.getFullYear(),open.getMonth()+i,1);
      const yr=d.getFullYear(),mo=d.getMonth(),season=getSeason(mo),seaMult=store.seasonality?.[season]||1;
      const dim=new Date(yr,mo+1,0).getDate();
      let wd=0,sat=0,sun=0;
      for(let day=1;day<=dim;day++){
        const dd=new Date(yr,mo,day);if(dd<open)continue;
        const dow=dd.getDay(),key=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const exc=store.schedule?.exceptions?.[key];
        if(exc?.closed)continue;
        if(dow===0){if(!store.schedule?.sunday?.closed&&!exc)sun++;}
        else if(dow===6){if(!store.schedule?.saturday?.closed&&!exc)sat++;}
        else{if(!store.schedule?.weekday?.closed&&!exc)wd++;}
      }
      const h=(store.holidaysPerYear||6)/12;
      const tot=Math.max(0,wd-h)+sat+sun;
      result.push({label:`${MN[mo]} ${yr}`,season,seaMult,opDays:Math.round(tot*10)/10,idx:i});
    }
    return result;
  },[openDate,store.seasonality,store.schedule,store.holidaysPerYear,periods]);
  const[showAll,setShowAll]=useState(false);
  const disp=showAll?months:months.slice(0,12);
  const maxD=Math.max(...months.map(m=>m.opDays),1);
  if(!months.length)return<InfoBox>Set a hard open date in the Timeline section to see the operating calendar.</InfoBox>;
  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))",gap:8}}>
        {disp.map((m,i)=>{const sc=SEASON_CLR[m.season],bw=Math.round((m.opDays/maxD)*100);return(
          <div key={i} style={{backgroundColor:m.idx===0?CN.orangeLight:sc.bg,border:`1.5px solid ${m.idx===0?CN.orange:sc.border}`,borderRadius:10,padding:"10px 10px 8px",position:"relative"}}>
            {m.idx===0&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",fontSize:9,fontWeight:800,backgroundColor:CN.orange,color:CN.white,padding:"1px 7px",borderRadius:99,whiteSpace:"nowrap",fontFamily:FH}}>OPEN</div>}
            <div style={{fontSize:13,fontWeight:700,color:CN.dark,fontFamily:FB}}>{m.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:m.idx===0?CN.orange:sc.text,fontFamily:FH,lineHeight:1.2,marginTop:4}}>{m.opDays}</div>
            <div style={{fontSize:13,color:CN.mid,fontFamily:FB}}>op. days</div>
            <div style={{marginTop:6,height:3,backgroundColor:"rgba(0,0,0,0.08)",borderRadius:2}}><div style={{width:`${bw}%`,height:"100%",borderRadius:2,backgroundColor:m.idx===0?CN.orange:sc.text}}/></div>
            <div style={{fontSize:12,color:CN.mid,marginTop:3,fontFamily:FB}}>{m.season} · {m.seaMult}×</div>
          </div>
        );})}
      </div>
      <button onClick={()=>setShowAll(v=>!v)} style={{marginTop:12,border:`1px solid ${CN.border}`,borderRadius:8,backgroundColor:CN.white,color:CN.mid,fontSize:14,fontWeight:600,padding:"7px 16px",cursor:"pointer",fontFamily:FB}}>
        {showAll?`Show first 12 ↑`:`Show all ${months.length} months ↓`}
      </button>
    </div>
  );
}

// ── Section 1: About ──────────────────────────────────────────────
function SecAbout({store,onChange}){
  const s=(k,v)=>onChange(p=>({...deepClone(p),[k]:v}));
  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
        <FG label="Store Name" required><input placeholder="e.g. Cheeky Noodles Ridgefield" value={store.name||""} onChange={e=>s("name",e.target.value)} style={INP}/></FG>
        <FG label="Location / City" required note="Used by AI for market analysis and forecasting"><input placeholder="e.g. Ridgefield, WA" value={store.address||""} onChange={e=>s("address",e.target.value)} style={INP}/></FG>
        <FG label="Website"><input placeholder="e.g. cheekynoodles.com" value={store.website||""} onChange={e=>s("website",e.target.value)} style={INP}/></FG>
      </div>
      <FG label="About this Location" note="Describe the concept, format, target market, and anything relevant for AI-powered forecasting.">
        <textarea rows={4} placeholder="e.g. Fast-casual noodle bar in Ridgefield, WA. Quick-service format targeting young families and working adults. Focus on customisable noodle bowls at approachable price points…" value={store.description||""} onChange={e=>s("description",e.target.value)} style={{...INP,resize:"vertical",lineHeight:1.6}}/>
      </FG>
    </div>
  );
}

// ── Section 2: Timeline ───────────────────────────────────────────
function SecTimeline({store,onChange}){
  const s=(path,v)=>onChange(p=>{const n=deepClone(p);const keys=path.split(".");let obj=n;for(let i=0;i<keys.length-1;i++)obj=obj[keys[i]];obj[keys[keys.length-1]]=v;return n;});
  const tl=store.timeline||{};
  const comp=tl.handoverDate&&tl.constructionWeeks?addWeeks(tl.handoverDate,parseInt(tl.constructionWeeks)||0):"";
  const phases=[
    {l:"Site Handover",d:tl.handoverDate,c:CN.amber,i:"🔑"},
    {l:`Construction (${tl.constructionWeeks||16}w)`,d:null,c:CN.mid,i:"🏗️"},
    {l:"Expected Completion",d:comp,c:CN.blue,i:"✅"},
    {l:"Soft Open",d:tl.softOpenDate,c:CN.orange,i:"🍜"},
    {l:"Hard Open",d:tl.hardOpenDate,c:CN.green,i:"🎉"},
  ];
  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"0 20px"}}>
        <FG label="Site Handover Date" required><input type="date" value={tl.handoverDate||""} onChange={e=>s("timeline.handoverDate",e.target.value)} style={INP}/></FG>
        <FG label="Construction / Fit-out (weeks)" required><input type="number" min="1" max="104" step="1" value={tl.constructionWeeks||16} onChange={e=>s("timeline.constructionWeeks",parseInt(e.target.value)||0)} style={INP}/></FG>
        <FG label="Expected Completion" note="Auto-calculated: Handover + construction"><input type="date" value={comp} readOnly style={{...INP,backgroundColor:CN.creamDark,color:CN.mid,cursor:"not-allowed"}}/></FG>
        <FG label="Soft Open Date" note="Preview / friends & family launch"><input type="date" value={tl.softOpenDate||""} onChange={e=>s("timeline.softOpenDate",e.target.value)} style={INP}/></FG>
        <FG label="Hard Open Date" required note="First day of normal trading — forecast starts here"><input type="date" value={tl.hardOpenDate||""} onChange={e=>s("timeline.hardOpenDate",e.target.value)} style={INP}/></FG>
      </div>
      {tl.handoverDate&&(
        <div style={{marginTop:8,overflowX:"auto"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:0,minWidth:580,paddingBottom:8}}>
            {phases.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",flex:i===1?2:1,minWidth:0}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:0,flex:1}}>
                  <div style={{width:38,height:38,borderRadius:"50%",backgroundColor:p.d||i===1?p.c:CN.border,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,boxShadow:"0 2px 8px rgba(0,0,0,0.12)",opacity:p.d||i===1?1:0.35}}>{p.i}</div>
                  <div style={{textAlign:"center",marginTop:7,minWidth:0,padding:"0 4px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:CN.dark,fontFamily:FB}}>{p.l}</div>
                    <div style={{fontSize:12,color:CN.mid,fontFamily:FB,marginTop:1}}>{p.d?fmtDate(p.d):"—"}</div>
                  </div>
                </div>
                {i<phases.length-1&&<div style={{flex:1,height:2,backgroundColor:CN.border,marginTop:18,backgroundImage:i===1?`repeating-linear-gradient(90deg,${CN.amber} 0,${CN.amber} 6px,transparent 6px,transparent 12px)`:"none"}}/>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tl.handoverDate&&tl.hardOpenDate&&(
        <InfoBox type="success">✓ Forecast runs from <strong>{fmtDate(tl.hardOpenDate)}</strong>. Hard open confirmed.</InfoBox>
      )}
    </div>
  );
}

// ── Section 4: Seasonality with AI ───────────────────────────────
function SecSeasonality({store,onChange}){
  const[showAI,setShowAI]=useState(false);
  const sea=store.seasonality||{};
  const maxM=Math.max(...Object.values(sea),1);
  const seasons=Object.keys(SEASON_MONTHS);
  const missingCtx=!store.name&&!store.address?"Complete the About section (name and location) first so Claude can give location-specific advice.":null;

  const buildSystemPrompt=()=>`You are a restaurant industry analyst helping calibrate seasonal revenue multipliers for ${store.name||"a new restaurant"} at ${store.address||"an undisclosed location"}.

Store description: ${store.description||"No description provided."}
Hard open date: ${store.timeline?.hardOpenDate||"not set"}
Current multipliers — Winter:${sea.Winter} Spring:${sea.Spring} Summer:${sea.Summer} Fall:${sea.Fall} (1.0=normal, 0.8=20% below)

Suggest revised multipliers for all four seasons with specific reasoning for THIS location (local climate, school calendars, tourism patterns, local events, demographics). Flag any risks or opportunities. End your response with a JSON block like:
\`\`\`json
{"Winter": 0.0, "Spring": 0.0, "Summer": 0.0, "Fall": 0.0}
\`\`\``;

  const saveHistory=(history)=>{
    // Extract latest JSON suggestion if present
    const lastAI=[...history].reverse().find(m=>m.role==="assistant");
    let sug=null;
    if(lastAI){const m=lastAI.content.match(/```json\s*([\s\S]*?)```/);if(m){try{sug=JSON.parse(m[1]);}catch{}}}
    onChange(prev=>({...deepClone(prev),
      aiSeasonality:{history,generatedAt:new Date().toISOString(),suggestion:sug},
      ...(sug?{seasonality:sug}:{}),
    }));
  };

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
        {seasons.map(s=>{const sc=SEASON_CLR[s],mult=sea[s]||1,bh=Math.round((mult/maxM)*80);return(
          <div key={s} style={{backgroundColor:sc.bg,border:`1.5px solid ${sc.border}`,borderRadius:12,padding:"14px 14px 12px"}}>
            <div style={{fontWeight:700,fontSize:15,color:sc.text,marginBottom:10,fontFamily:FB}}>{s}</div>
            <div style={{height:64,display:"flex",alignItems:"flex-end",marginBottom:10}}>
              <div style={{width:"100%",height:`${Math.max(bh,4)}%`,backgroundColor:sc.text,borderRadius:"4px 4px 0 0",opacity:0.7,transition:"height 0.3s"}}/>
            </div>
            <input type="number" min="0.1" max="2" step="0.05" value={mult}
              onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0)onChange(p=>({...deepClone(p),seasonality:{...p.seasonality,[s]:v}}));}}
              style={{...INP,textAlign:"center",fontWeight:700,fontSize:18,padding:"7px"}}/>
            <div style={{fontSize:13,color:sc.text,textAlign:"center",marginTop:5,fontFamily:FB}}>{Math.round(mult*100)}% of base</div>
            <div style={{fontSize:11,color:CN.mid,textAlign:"center",marginTop:2,fontFamily:FB}}>{SEASON_MONTHS[s].map(m=>MN[m]).join(", ")}</div>
          </div>
        );})}
      </div>

      {store.aiSeasonality?.suggestion&&(
        <SuggestionBox
          generatedAt={store.aiSeasonality.generatedAt}
          rows={Object.entries(store.aiSeasonality.suggestion).map(([s,v])=>({label:s,current:`${sea[s]||1}\u00d7`,suggested:`${v}\u00d7`}))}
          onApply={()=>onChange(p=>({...deepClone(p),seasonality:store.aiSeasonality.suggestion}))}
          onDismiss={()=>onChange(p=>({...deepClone(p),aiSeasonality:{...p.aiSeasonality,suggestion:null}}))}
        />
      )}

      <AiNarrativeCard aiData={store.aiSeasonality} label="Seasonality Analysis"/>

      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:14}}>
        <Btn variant="ai" onClick={()=>setShowAI(true)}>
          <span>✨</span>{store.aiSeasonality?"Continue AI Chat":"Check with AI"}
        </Btn>
        {store.aiSeasonality&&<span style={{fontSize:13,color:CN.mid,fontFamily:FB}}>Saved {fmtDate(store.aiSeasonality.generatedAt?.split("T")[0])}</span>}
      </div>
      {showAI&&<ChatPanel title="Seasonality Analysis" systemPrompt={buildSystemPrompt()} savedHistory={store.aiSeasonality?.history||[]} onSaveHistory={saveHistory} onClose={()=>setShowAI(false)} missingContext={missingCtx}/>}
    </div>
  );
}

// ── Section 5: Scenarios ──────────────────────────────────────────
function SecScenarios({store,onChange}){
  const[rid,setRid]=useState(null);const[rv,setRv]=useState("");
  const sc=store.scenarios||[];
  const upd=(id,p)=>onChange(prev=>({...deepClone(prev),scenarios:prev.scenarios.map(s=>s.id===id?{...s,...p}:s)}));
  const setBase=(id)=>onChange(prev=>({...deepClone(prev),scenarios:prev.scenarios.map(s=>({...s,isBase:s.id===id}))}));
  const getCell=(a,g)=>sc.find(s=>s.acquisition===a&&s.growth===g);
  const base=sc.find(s=>s.isBase);
  return(
    <div>
      {base&&<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"10px 14px",backgroundColor:CN.orangeLight,border:`1.5px solid ${CN.orange}`,borderRadius:10}}>
        <span style={{fontSize:20}}>⭐</span>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:CN.orange,fontFamily:FB}}>Base Scenario</div>
          <div style={{fontSize:15,color:CN.dark,fontFamily:FB}}>{base.name} — {base.acquisition} Acquisition · {base.growth} Growth</div>
        </div>
      </div>}
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"separate",borderSpacing:6,width:"100%"}}>
          <thead>
            <tr>
              <th style={{width:110}}/>
              {["Low Growth","Mid Growth","High Growth"].map(g=><th key={g} style={{padding:"8px 12px",fontSize:13,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.mid,textAlign:"center",fontFamily:FB}}>{g}</th>)}
            </tr>
          </thead>
          <tbody>
            {ACQL.map(acq=>(
              <tr key={acq}>
                <td style={{padding:"4px 8px 4px 0",verticalAlign:"middle"}}>
                  <div style={{fontSize:13,fontWeight:700,color:ACLR[acq],backgroundColor:ACBG[acq],padding:"5px 10px",borderRadius:8,textAlign:"center",fontFamily:FB}}>{acq} Acq</div>
                </td>
                {["Low","Mid","High"].map(growth=>{
                  const s=getCell(acq,growth);if(!s)return<td key={growth}/>;
                  return(
                    <td key={growth} style={{padding:0,verticalAlign:"top"}}>
                      <div style={{border:`2px solid ${s.isBase?CN.orange:s.active?CN.border:CN.creamDark}`,borderRadius:12,padding:"12px 12px 10px",backgroundColor:s.isBase?CN.orangeLight:s.active?CN.white:CN.creamDark,opacity:s.active?1:0.55,minWidth:140,position:"relative",transition:"all 0.15s"}}>
                        {s.isBase&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",fontSize:10,fontWeight:800,backgroundColor:CN.orange,color:CN.white,padding:"2px 8px",borderRadius:99,whiteSpace:"nowrap",fontFamily:FH}}>BASE</div>}
                        {rid===s.id
                          ?<input autoFocus value={rv} onChange={e=>setRv(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){upd(s.id,{name:rv.trim()||s.name});setRid(null);}if(e.key==="Escape")setRid(null);}} onBlur={()=>{upd(s.id,{name:rv.trim()||s.name});setRid(null);}} style={{...INP,fontSize:13,padding:"3px 7px",marginBottom:6}}/>
                          :<div style={{fontSize:13,fontWeight:700,color:s.isBase?CN.orange:CN.dark,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:FB}}>
                            <span>{s.name}</span>
                            <button onClick={()=>{setRid(s.id);setRv(s.name);}} style={{fontSize:12,background:"none",border:"none",cursor:"pointer",color:CN.mid,padding:"0 2px"}}>✏️</button>
                          </div>
                        }
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          <button onClick={()=>upd(s.id,{active:!s.active})} style={{fontSize:12,fontWeight:700,padding:"3px 9px",borderRadius:6,cursor:"pointer",border:`1.5px solid ${s.active?CN.border:CN.mid}`,fontFamily:FB,backgroundColor:s.active?CN.creamDark:"transparent",color:s.active?CN.dark:CN.mid}}>{s.active?"Active":"Inactive"}</button>
                          {!s.isBase&&s.active&&(
                            <button onClick={()=>setBase(s.id)} style={{fontSize:12,fontWeight:700,padding:"3px 9px",borderRadius:6,cursor:"pointer",border:`1.5px solid ${CN.orange}`,fontFamily:FB,backgroundColor:CN.orangeLight,color:CN.orange}}>Set Base ⭐</button>
                          )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:13,color:CN.mid,fontFamily:FB}}>{sc.filter(s=>s.active).length} of {sc.length} scenarios active</div>
    </div>
  );
}

// ── Section 6: Acquisition with AI ───────────────────────────────
function SecAcquisition({store,onChange}){
  const[showAI,setShowAI]=useState(false);
  const loc=store.address||"the local area";
  const profs=store.acquisitionProfiles||{};
  const missingCtx=!store.name&&!store.address?"Complete the About section first.":null;

  const buildSystemPrompt=()=>`You are a restaurant industry analyst helping ${store.name||"a new restaurant"} at ${store.address||"an undisclosed location"} estimate opening-month transaction volumes.

Store description: ${store.description||"No description provided."}
Hard open date: ${store.timeline?.hardOpenDate||"not set"}
Current estimates — Low:${profs.Low?.baseTransactions} Mid:${profs.Mid?.baseTransactions} High:${profs.High?.baseTransactions} transactions/month
(Based on ${loc} household data × capture rate)

For each scenario:
1. Recommended monthly transaction volume for this location
2. Implied daily rate and weekly equivalent
3. Key assumptions: households in trade area, capture rate %, visit frequency
4. Benchmarks and references (census data, NRA, Toast, comparable openings)

End with a JSON block: \`\`\`json\n{"Low": 0, "Mid": 0, "High": 0}\n\`\`\``;

  const saveHistory=(history)=>{
    const lastAI=[...history].reverse().find(m=>m.role==="assistant");
    let sug=null;
    if(lastAI){const m=lastAI.content.match(/```json\s*([\s\S]*?)```/);if(m){try{sug=JSON.parse(m[1]);}catch{}}}
    onChange(prev=>({...deepClone(prev),aiAcquisition:{history,generatedAt:new Date().toISOString(),suggestion:sug}}));
  };

  return(
    <div>
      <InfoBox>Base transaction volume at opening month for each acquisition level. Derived from <strong>{loc}</strong> household data × estimated capture rate.</InfoBox>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
        {ACQL.map(pk=>{const p=profs[pk]||{};return(
          <div key={pk} style={{backgroundColor:ACBG[pk],border:`1.5px solid ${ACLR[pk]}40`,borderRadius:12,padding:16}}>
            <div style={{fontSize:14,fontWeight:700,color:ACLR[pk],marginBottom:10,fontFamily:FB}}>{pk} Acquisition</div>
            <FG label="Base Transactions / Month">
              <input type="number" min="1" step="10" value={p.baseTransactions||""}
                onChange={e=>onChange(prev=>({...deepClone(prev),acquisitionProfiles:{...prev.acquisitionProfiles,[pk]:{...p,baseTransactions:parseInt(e.target.value)||0}}}))}
                style={{...INP,fontWeight:700,fontSize:18,textAlign:"center"}}/>
            </FG>
            <div style={{fontSize:13,color:CN.mid,fontFamily:FB}}>≈ {Math.round((p.baseTransactions||0)/30)} tx/day</div>
          </div>
        );})}
      </div>
      {store.aiAcquisition?.suggestion&&(
        <SuggestionBox
          generatedAt={store.aiAcquisition.generatedAt}
          rows={["Low","Mid","High"].map(k=>({label:`${k} Acquisition`,current:`${(store.acquisitionProfiles?.[k]?.baseTransactions||0).toLocaleString()} tx/mo`,suggested:`${(store.aiAcquisition.suggestion[k]||0).toLocaleString()} tx/mo`}))}
          onApply={()=>onChange(prev=>({...deepClone(prev),acquisitionProfiles:{Low:{...prev.acquisitionProfiles.Low,baseTransactions:store.aiAcquisition.suggestion.Low},Mid:{...prev.acquisitionProfiles.Mid,baseTransactions:store.aiAcquisition.suggestion.Mid},High:{...prev.acquisitionProfiles.High,baseTransactions:store.aiAcquisition.suggestion.High}}}))}
          onDismiss={()=>onChange(p=>({...deepClone(p),aiAcquisition:{...p.aiAcquisition,suggestion:null}}))}
        />
      )}

      <AiNarrativeCard aiData={store.aiAcquisition} label="Acquisition Analysis"/>

      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:14}}>
        <Btn variant="ai" onClick={()=>setShowAI(true)}>
          <span>✨</span>{store.aiAcquisition?"Continue AI Chat":"Check with AI"}
        </Btn>
        {store.aiAcquisition&&<span style={{fontSize:13,color:CN.mid,fontFamily:FB}}>Saved {fmtDate(store.aiAcquisition.generatedAt?.split("T")[0])}</span>}
      </div>
      {showAI&&<ChatPanel title="Acquisition Analysis" systemPrompt={buildSystemPrompt()} savedHistory={store.aiAcquisition?.history||[]} onSaveHistory={saveHistory} onClose={()=>setShowAI(false)} missingContext={missingCtx}/>}
    </div>
  );
}

// ── Section 7: Growth with AI ─────────────────────────────────────
function SecGrowth({store,onChange}){
  const[showAI,setShowAI]=useState(false);
  const[expanded,setExpanded]=useState(null);
  const gp=store.growthProfiles||{};
  const missingCtx=!store.name&&!store.address?"Complete the About section first.":null;

  const buildSystemPrompt=()=>{
    const ps=Object.entries(gp).map(([k,p])=>`${k} Growth: peak ${Math.round(Math.max(...(p.rampRates||[0]).slice(1))*100)}%/mo, stabilises at ${((p.stabilisedRate||0)*100).toFixed(1)}%/mo`).join("; ");
    return`You are a restaurant industry growth analyst evaluating growth rate assumptions for ${store.name||"a new restaurant"} at ${store.address||"an undisclosed location"}.

Store description: ${store.description||"No description provided."}
Mid acquisition base: ${store.acquisitionProfiles?.Mid?.baseTransactions||"not set"} transactions/month
Growth assumptions: ${ps}

Assess whether each profile is realistic, aggressive, or conservative for this concept and location. Suggest any adjustments. Flag key risks. Cite industry benchmarks (NRA, 7shifts, Toast, or comparable openings).`;
  };

  const saveHistory=(history)=>{
    onChange(prev=>({...deepClone(prev),aiGrowth:{history,generatedAt:new Date().toISOString()}}));
  };

  const updRate=(pk,i,v)=>onChange(prev=>{const n=deepClone(prev);n.growthProfiles[pk].rampRates[i]=parseFloat(v)||0;return n;});
  const updStable=(pk,v)=>onChange(prev=>{const n=deepClone(prev);n.growthProfiles[pk].stabilisedRate=parseFloat(v)||0;return n;});

  return(
    <div>
      <InfoBox>Month-on-month growth applied to transaction volume. Month 1 = opening month (rate = 0, base). After month 12, the stabilised rate applies indefinitely.</InfoBox>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
        {ACQL.map(pk=>{
          const p=gp[pk]||{},isOpen=expanded===pk,maxR=Math.max(...(p.rampRates||[0]).slice(1),0.01);
          return(
            <div key={pk} style={{border:`1.5px solid ${isOpen?ACLR[pk]:CN.border}`,borderRadius:12,overflow:"hidden",backgroundColor:isOpen?CN.white:CN.creamDark,transition:"all 0.2s"}}>
              <button onClick={()=>setExpanded(isOpen?null:pk)} style={{width:"100%",padding:"12px 14px",background:"none",border:"none",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:ACLR[pk],fontFamily:FB}}>{p.label||pk}</div>
                  <div style={{fontSize:13,color:CN.mid,marginTop:2,fontFamily:FB}}>Peak {Math.round(maxR*100)}% · Stable {((p.stabilisedRate||0)*100).toFixed(1)}%/mo</div>
                </div>
                <span style={{fontSize:13,color:CN.mid}}>{isOpen?"▲":"▼"}</span>
              </button>
              <div style={{padding:"0 14px 12px",display:"flex",gap:2,alignItems:"flex-end",height:32}}>
                {(p.rampRates||[]).slice(1).map((r,i)=><div key={i} style={{flex:1,backgroundColor:ACBG[pk],borderRadius:"2px 2px 0 0",height:`${Math.round((r/maxR)*100)}%`,minHeight:2,border:`1px solid ${ACLR[pk]}`,opacity:0.6}}/>)}
              </div>
              {isOpen&&(
                <div style={{padding:"12px 14px 14px",borderTop:`1px solid ${CN.border}`}}>
                  <div style={{fontSize:12,fontWeight:700,color:CN.mid,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8,fontFamily:FB}}>Monthly growth rates</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 10px"}}>
                    {(p.rampRates||[]).map((r,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:13,color:CN.mid,width:40,flexShrink:0,fontFamily:FB}}>Mo {i+1}</span>
                        <input type="number" step="0.01" min="0" max="2" value={r} disabled={i===0} onChange={e=>updRate(pk,i,e.target.value)} style={{...INP,padding:"4px 7px",fontSize:13,textAlign:"right",opacity:i===0?0.4:1}}/>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,color:CN.mid,flex:1,fontFamily:FB}}>Stabilised rate (Mo 13+)</span>
                    <input type="number" step="0.001" min="0" max="0.1" value={p.stabilisedRate||0} onChange={e=>updStable(pk,e.target.value)} style={{...INP,padding:"4px 7px",fontSize:13,width:90,textAlign:"right"}}/>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AiNarrativeCard aiData={store.aiGrowth} label="Growth Profile Analysis"/>

      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:14}}>
        <Btn variant="ai" onClick={()=>setShowAI(true)}>
          <span>✨</span>{store.aiGrowth?"Continue AI Chat":"Check with AI"}
        </Btn>
        {store.aiGrowth&&<span style={{fontSize:13,color:CN.mid,fontFamily:FB}}>Saved {fmtDate(store.aiGrowth.generatedAt?.split("T")[0])}</span>}
      </div>
      {showAI&&<ChatPanel title="Growth Profile Analysis" systemPrompt={buildSystemPrompt()} savedHistory={store.aiGrowth?.history||[]} onSaveHistory={saveHistory} onClose={()=>setShowAI(false)} missingContext={missingCtx}/>}
    </div>
  );
}

// ── Setup Wizard ──────────────────────────────────────────────────
const STEPS=[
  {id:"about",num:1,title:"About the Location",sub:"Name, address, and concept description"},
  {id:"timeline",num:2,title:"Store Timeline",sub:"Key dates from handover to opening"},
  {id:"schedule",num:3,title:"Operating Schedule",sub:"Trading hours and calendar exceptions"},
  {id:"seasonality",num:4,title:"Seasonality",sub:"Volume multipliers by season"},
  {id:"acquisition",num:5,title:"Acquisition Profiles",sub:"Opening-month transaction volumes"},
  {id:"growth",num:6,title:"Growth Profiles",sub:"Month-on-month growth assumptions"},
  {id:"scenarios",num:7,title:"Scenario Matrix",sub:"Activate scenarios and set the base case"},
];

function SetupWizard({store,onUpdate,onComplete,onCancel,onDiscard,isNew,periods}){
  const[step,setStep]=useState(0);
  const[confirmDiscard,setConfirmDiscard]=useState(false);
  const cur=STEPS[step],isLast=step===STEPS.length-1,canNext=isSectionComplete(store,cur.id);
  const goNext=()=>isLast?onComplete():setStep(s=>s+1);
  return(
    <div style={{position:"fixed",inset:0,backgroundColor:"rgba(28,24,20,0.75)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{backgroundColor:CN.cream,borderRadius:18,width:"100%",maxWidth:900,maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.3)"}}>
        {/* Header */}
        <div style={{padding:"20px 28px 16px",borderBottom:`1.5px solid ${CN.border}`,backgroundColor:CN.white,display:"flex",alignItems:"center",gap:16,flexShrink:0}}>
          <div style={{flex:1}}>
            <div style={{fontFamily:FH,fontSize:22,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark}}>Store Setup</div>
            <div style={{fontSize:14,color:CN.mid,fontFamily:FB,marginTop:2}}>Step {step+1} of {STEPS.length} — {cur.title}</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {STEPS.map((s,i)=>(
              <button key={s.id} onClick={()=>i<=step?setStep(i):null} style={{width:i===step?28:10,height:10,borderRadius:5,backgroundColor:i<step?CN.green:i===step?CN.orange:CN.border,border:"none",cursor:i<=step?"pointer":"default",transition:"all 0.2s",padding:0}} title={s.title}/>
            ))}
          </div>
        </div>
        {/* Content */}
        <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:20}}>
            <div style={{width:34,height:34,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,backgroundColor:canNext?CN.green:CN.orange,color:CN.white,fontFamily:FH}}>{canNext?"✓":cur.num}</div>
            <div>
              <h2 style={{fontFamily:FH,fontWeight:800,fontSize:20,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,margin:0}}>{cur.title}</h2>
              {cur.sub&&<p style={{fontSize:14,color:CN.mid,marginTop:4,margin:"4px 0 0",fontFamily:FB}}>{cur.sub}</p>}
            </div>
          </div>
          {cur.id==="about"&&<SecAbout store={store} onChange={onUpdate}/>}
          {cur.id==="timeline"&&<SecTimeline store={store} onChange={onUpdate}/>}
          {cur.id==="schedule"&&<>
            <ScheduleCalendar schedule={store.schedule||{}} onChange={sc=>onUpdate(p=>({...deepClone(p),schedule:sc}))}/>
            <div style={{marginTop:24,paddingTop:20,borderTop:`1px solid ${CN.border}`}}>
              <div style={{fontFamily:FH,fontSize:16,fontWeight:800,textTransform:"uppercase",color:CN.dark,marginBottom:14,letterSpacing:"0.06em"}}>Operating Calendar Preview</div>
              <OpCalendar store={store} periods={periods}/>
            </div>
          </>}
          {cur.id==="seasonality"&&<SecSeasonality store={store} onChange={onUpdate}/>}
          {cur.id==="scenarios"&&<SecScenarios store={store} onChange={onUpdate}/>}
          {cur.id==="acquisition"&&<SecAcquisition store={store} onChange={onUpdate}/>}
          {cur.id==="growth"&&<SecGrowth store={store} onChange={onUpdate}/>}
        </div>
        {/* Footer */}
        <div style={{padding:"16px 28px",borderTop:`1.5px solid ${CN.border}`,backgroundColor:CN.white,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {onCancel&&<Btn variant="secondary" onClick={onCancel}>Save & Exit</Btn>}
            {step>0&&<Btn variant="secondary" onClick={()=>setStep(s=>s-1)}>← Back</Btn>}
            {onDiscard&&!confirmDiscard&&(
              <button onClick={()=>setConfirmDiscard(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:CN.mid,fontFamily:FB,padding:"6px 4px",textDecoration:"underline",textUnderlineOffset:2}}>
                Cancel
              </button>
            )}
            {confirmDiscard&&(
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",backgroundColor:CN.redLight,border:`1px solid ${CN.red}`,borderRadius:8}}>
                <span style={{fontSize:13,color:CN.red,fontFamily:FB}}>{isNew?"Discard new store?":"Discard changes?"}</span>
                <button onClick={onDiscard} style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:6,border:"none",backgroundColor:CN.red,color:CN.white,cursor:"pointer",fontFamily:FB}}>Discard</button>
                <button onClick={()=>setConfirmDiscard(false)} style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:6,border:`1px solid ${CN.red}`,backgroundColor:"transparent",color:CN.red,cursor:"pointer",fontFamily:FB}}>Keep editing</button>
              </div>
            )}
          </div>
          <Btn onClick={goNext} disabled={!canNext}>{isLast?"Complete Setup ✓":`Next: ${STEPS[step+1]?.title} →`}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Store selector ────────────────────────────────────────────────
function StoreSelector({stores,activeId,onSelect,onAdd,onDelete,isAdmin}){
  const[delConfirm,setDelConfirm]=useState(null);
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,padding:"14px 18px",backgroundColor:CN.white,border:`1.5px solid ${CN.border}`,borderRadius:14,flexWrap:"wrap"}}>
      <div style={{fontFamily:FH,fontSize:13,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:CN.mid,flexShrink:0}}>Store</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",flex:1}}>
        {stores.map(s=>(
          <button key={s.id} onClick={()=>onSelect(s.id)} style={{padding:"7px 16px",borderRadius:8,fontFamily:FB,fontSize:14,fontWeight:600,cursor:"pointer",transition:"all 0.15s",border:`2px solid ${s.id===activeId?CN.orange:CN.border}`,backgroundColor:s.id===activeId?CN.orangeLight:CN.white,color:s.id===activeId?CN.orange:CN.dark}}>
            {s.name||"Unnamed Store"}
            {!SECTIONS.every(sec=>isSectionComplete(s,sec))&&<span style={{marginLeft:6,fontSize:11,color:CN.amber}}>●</span>}
            {isAdmin&&stores.length>1&&s.id===activeId&&(
              <span onClick={e=>{e.stopPropagation();setDelConfirm(s);}} style={{marginLeft:8,fontSize:13,color:CN.red,cursor:"pointer"}} title="Delete store">✕</span>
            )}
          </button>
        ))}
        {isAdmin&&<button onClick={onAdd} style={{padding:"7px 16px",borderRadius:8,fontFamily:FB,fontSize:14,fontWeight:700,cursor:"pointer",border:`2px dashed ${CN.orange}`,backgroundColor:"transparent",color:CN.orange}}>+ Add Store</button>}
      </div>
      <AlertDialog.Root open={!!delConfirm} onOpenChange={v=>!v&&setDelConfirm(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.5)",zIndex:2000}}/>
          <AlertDialog.Content style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",backgroundColor:CN.white,borderRadius:14,padding:24,maxWidth:380,width:"calc(100% - 40px)",zIndex:2001,fontFamily:FB}}>
            <AlertDialog.Title style={{fontFamily:FH,fontSize:18,textTransform:"uppercase",color:CN.dark,marginBottom:8}}>Delete Store</AlertDialog.Title>
            <AlertDialog.Description style={{fontSize:15,color:CN.mid,marginBottom:20,lineHeight:1.6}}>Permanently delete <strong>"{delConfirm?.name}"</strong> and all its forecast data? Cannot be undone.</AlertDialog.Description>
            <div style={{display:"flex",gap:8}}>
              <AlertDialog.Action asChild><Btn variant="danger" onClick={()=>{onDelete(delConfirm.id);setDelConfirm(null);}}>Delete Store</Btn></AlertDialog.Action>
              <AlertDialog.Cancel asChild><Btn variant="secondary">Cancel</Btn></AlertDialog.Cancel>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────
export function StoreSetupTab({stores,setStores,activeStoreId,setActiveStoreId,periods,savedStores,onSave,onClear,saving,isMobile,isAdmin}){
  const[showWizard,setShowWizard]=useState(false);
  const[wizardStore,setWizardStore]=useState(null);
  const[isNew,setIsNew]=useState(false);
  const active=stores.find(s=>s.id===activeStoreId)||null;

  useEffect(()=>{
    if(!stores||stores.length===0){const f={...deepClone(DEFAULT_STORE),id:uid(),name:""};setWizardStore(f);setIsNew(true);setShowWizard(true);}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const updateActive=useCallback(fn=>setStores(prev=>prev.map(s=>s.id===activeStoreId?(typeof fn==="function"?fn(s):fn):s)),[activeStoreId,setStores]);
  const addStore=()=>{const f={...deepClone(DEFAULT_STORE),id:uid(),name:""};setWizardStore(f);setIsNew(true);setShowWizard(true);};
  const deleteStore=(id)=>setStores(prev=>{const r=prev.filter(s=>s.id!==id);if(activeStoreId===id&&r.length>0)setActiveStoreId(r[0].id);return r;});
  const completeWizard=()=>{if(!wizardStore)return;const c={...wizardStore,setupComplete:true};if(isNew){setStores(p=>[...p,c]);setActiveStoreId(c.id);}else setStores(p=>p.map(s=>s.id===c.id?c:s));setShowWizard(false);setWizardStore(null);setIsNew(false);setTimeout(()=>onSave?.(),100);};
  const exitWizard=()=>{if(!wizardStore){setShowWizard(false);return;}if(isNew){setStores(p=>[...p,{...wizardStore,setupComplete:false}]);setActiveStoreId(wizardStore.id);}else setStores(p=>p.map(s=>s.id===wizardStore.id?{...wizardStore,setupComplete:false}:s));setShowWizard(false);setWizardStore(null);setTimeout(()=>onSave?.(),100);};
  const discardWizard=()=>{setShowWizard(false);setWizardStore(null);setIsNew(false);};

  const dirty=JSON.stringify(stores)!==JSON.stringify(savedStores);
  const sections=STEPS.map(ws=>({...ws,complete:isSectionComplete(active,ws.id),locked:!canAccess(active,ws.id)}));

  return(
    <div>
      {showWizard&&wizardStore&&<SetupWizard store={wizardStore} onUpdate={setWizardStore} onComplete={completeWizard} onCancel={exitWizard} onDiscard={discardWizard} isNew={isNew} periods={periods}/>}
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24,paddingBottom:20,borderBottom:`1.5px solid ${CN.border}`,flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{fontFamily:FH,fontWeight:800,fontSize:28,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,margin:0}}>Store Setup</h1>
          <p style={{fontSize:14,color:CN.mid,marginTop:4,margin:"4px 0 0",fontFamily:FB}}>Forecast configuration per location. Complete all 7 sections to enable the revenue model.</p>
        </div>
        {active&&!active.setupComplete&&<Btn onClick={()=>{setWizardStore(deepClone(active));setIsNew(false);setShowWizard(true);}}>▶ Resume Setup Wizard</Btn>}
      </div>
      {/* Store selector */}
      {stores.length>0&&<StoreSelector stores={stores} activeId={activeStoreId} onSelect={setActiveStoreId} onAdd={addStore} onDelete={deleteStore} isAdmin={isAdmin}/>}
      {/* Empty state */}
      {stores.length===0&&!showWizard&&(
        <div style={{textAlign:"center",padding:"60px 20px"}}>
          <div style={{fontSize:48,marginBottom:16}}>🏪</div>
          <div style={{fontFamily:FH,fontSize:20,color:CN.dark,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>No Stores Yet</div>
          <div style={{fontSize:15,color:CN.mid,fontFamily:FB,marginBottom:20}}>Start by setting up your first location.</div>
          {isAdmin&&<Btn onClick={addStore}>+ Set Up First Store</Btn>}
        </div>
      )}
      {/* Active store sections */}
      {active&&(<>
        {/* Progress chips */}
        <div style={{display:"flex",gap:6,marginBottom:24,flexWrap:"wrap"}}>
          {sections.map(s=>(
            <div key={s.id} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:99,fontSize:13,fontFamily:FB,fontWeight:600,backgroundColor:s.complete?CN.greenLight:s.locked?CN.creamDark:CN.orangeLight,color:s.complete?CN.green:s.locked?CN.mid:CN.orange,border:`1px solid ${s.complete?CN.green:s.locked?CN.border:CN.orange}`,opacity:s.locked?0.5:1}}>
              <span>{s.complete?"✓":s.locked?"🔒":s.num}</span>{s.title}
            </div>
          ))}
        </div>
        {/* Section cards */}
        <SectionCard num={1} title="About the Location" subtitle="Store identity and concept description" complete={sections[0].complete} locked={sections[0].locked}><SecAbout store={active} onChange={updateActive}/></SectionCard>
        <SectionCard num={2} title="Store Timeline" subtitle="Handover, construction, and opening dates" complete={sections[1].complete} locked={sections[1].locked}><SecTimeline store={active} onChange={updateActive}/></SectionCard>
        <SectionCard num={3} title="Operating Schedule" subtitle="Trading hours and calendar exceptions" complete={sections[2].complete} locked={sections[2].locked}>
          <ScheduleCalendar schedule={active.schedule||{}} onChange={sc=>updateActive(p=>({...deepClone(p),schedule:sc}))}/>
          <div style={{marginTop:24,paddingTop:20,borderTop:`1px solid ${CN.border}`}}>
            <div style={{fontFamily:FH,fontSize:16,fontWeight:800,textTransform:"uppercase",color:CN.dark,marginBottom:14,letterSpacing:"0.06em"}}>Operating Calendar</div>
            <OpCalendar store={active} periods={periods}/>
          </div>
        </SectionCard>
        <SectionCard num={4} title="Seasonality Multipliers" subtitle="Volume adjustments by season, calibrated with AI" complete={sections[3].complete} locked={sections[3].locked}><SecSeasonality store={active} onChange={updateActive}/></SectionCard>
        <SectionCard num={5} title="Acquisition Profiles" subtitle="Opening transaction volumes by scenario" complete={sections[4].complete} locked={sections[4].locked}><SecAcquisition store={active} onChange={updateActive}/></SectionCard>
        <SectionCard num={6} title="Growth Profiles" subtitle="Month-on-month transaction growth assumptions" complete={sections[5].complete} locked={sections[5].locked}><SecGrowth store={active} onChange={updateActive}/></SectionCard>
        <SectionCard num={7} title="Scenario Matrix" subtitle="Activation and base scenario for forecasting" complete={sections[6].complete} locked={sections[6].locked}><SecScenarios store={active} onChange={updateActive}/></SectionCard>
        {SECTIONS.every(s=>isSectionComplete(active,s))&&<InfoBox type="success">✓ All sections complete. <strong>{active.name}</strong> is ready for revenue forecasting.</InfoBox>}
      </>)}
      {/* Save bar */}
      {dirty&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:24,paddingTop:16,borderTop:`1.5px solid ${CN.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:14,color:CN.orange,fontWeight:600,fontFamily:FB}}>
            <span style={{width:7,height:7,borderRadius:"50%",backgroundColor:CN.orange,display:"inline-block"}}/>Unsaved changes
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="secondary" onClick={onClear}>Clear</Btn>
            <Btn onClick={onSave} disabled={saving}>{saving?"Saving…":"Save"}</Btn>
          </div>
        </div>
      )}
      {isMobile&&<div style={{height:70}}/>}
    </div>
  );
}

// ── Admin period management ───────────────────────────────────────
export function AdminPeriodSetup({periods,setPeriods,onSave,saving}){
  const[local,setLocal]=useState(periods||DEFAULT_PERIODS);
  const[dirty,setDirty]=useState(false);
  useEffect(()=>setLocal(periods||DEFAULT_PERIODS),[periods]);
  const upd=v=>{setLocal(v);setDirty(true);};
  return(
    <div style={{backgroundColor:CN.white,border:`1.5px solid ${CN.border}`,borderRadius:14,padding:22,marginBottom:16}}>
      <div style={{fontFamily:FH,fontSize:16,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.06em",color:CN.dark,marginBottom:6}}>Forecast Periods</div>
      <p style={{fontSize:14,color:CN.mid,fontFamily:FB,marginBottom:16,lineHeight:1.5}}>Controls how many months each store's calendar and forecast extend. Default is 36 months. Only admins can extend this.</p>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12}}>
        <div>
          <Lbl>Total Forecast Months</Lbl>
          <input type="number" min="12" max="120" step="12" value={local.months||36} onChange={e=>upd({...local,months:parseInt(e.target.value)||36})} style={{...INP,width:100,fontWeight:700,fontSize:18,textAlign:"center"}}/>
        </div>
        <div style={{fontSize:15,color:CN.mid,fontFamily:FB}}>= {Math.round((local.months||36)/12)} year{Math.round((local.months||36)/12)!==1?"s":""} of forecasting</div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[24,36,48,60].map(m=><button key={m} onClick={()=>upd({...local,months:m})} style={{padding:"6px 16px",borderRadius:8,fontFamily:FB,fontSize:14,fontWeight:600,border:`1.5px solid ${(local.months||36)===m?CN.orange:CN.border}`,backgroundColor:(local.months||36)===m?CN.orangeLight:CN.white,color:(local.months||36)===m?CN.orange:CN.mid,cursor:"pointer"}}>{m}mo</button>)}
      </div>
      {dirty&&<div style={{display:"flex",gap:8}}>
        <Btn onClick={()=>{setPeriods(local);onSave?.(local);setDirty(false);}} disabled={saving}>{saving?"Saving…":"Save Period Settings"}</Btn>
        <Btn variant="secondary" onClick={()=>{setLocal(periods||DEFAULT_PERIODS);setDirty(false);}}>Cancel</Btn>
      </div>}
    </div>
  );
}