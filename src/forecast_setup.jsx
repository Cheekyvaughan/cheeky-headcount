// ── FP&A Forecast Setup — Phase 1 ────────────────────────────────
// Standalone component. Import and wire into headcount_planner_1.jsx
// following the instructions at the bottom of this file.
//
// Data stored under: SHARED_SK.forecastSetup = "cn-forecast-setup-v1"

import { useState, useEffect, useMemo } from "react";

// ── Brand (copy of CN from main file) ────────────────────────────
const CN = {
  orange:"#FF3C00", orangeHover:"#D93200", orangeLight:"#FFEDE8",
  cream:"#FBF5DF", creamDark:"#EFE7C8",
  dark:"#3C3C37", mid:"#494843",
  border:"#EAE6E5", white:"#FFFFFF",
  amber:"#F0B030", amberLight:"#FFF5CC", amberDark:"#C88800",
  red:"#CC2800", redLight:"#FFE0D8",
  blue:"#09A387", blueLight:"#D0EFE8",
  green:"#078A72", greenLight:"#D0EFE8",
};

// ── Default forecast setup (mirrors spreadsheet) ──────────────────
export const DEFAULT_FORECAST_SETUP = {
  // Store timeline
  handoverDate: "2025-12-15",
  constructionWeeks: 16,
  // openDate is derived — not stored (always computed from handover + construction)

  // Operating schedule
  schedule: {
    weekday:  { open: "12:00", close: "21:00", closed: false }, // Mon–Fri
    saturday: { open: "12:00", close: "20:00", closed: false },
    sunday:   { open: "12:00", close: "20:00", closed: false },
  },
  holidaysPerYear: 6,

  // Seasonality multipliers (applied to transaction volume)
  seasonality: {
    Winter: 1.00,  // Dec, Jan, Feb
    Spring: 0.85,  // Mar, Apr, May
    Summer: 0.80,  // Jun, Jul, Aug
    Fall:   0.95,  // Sep, Oct, Nov
  },

  // Base transactions at open by acquisition level
  acquisitionProfiles: {
    Low:  { label: "Low Acquisition",  baseTransactions: 1854 },
    Mid:  { label: "Mid Acquisition",  baseTransactions: 2780 },
    High: { label: "High Acquisition", baseTransactions: 3706 },
  },

  // Monthly growth rates by profile
  // Array = months 1-12+. After month 12 uses stabilised rate.
  growthProfiles: {
    Low: {
      label: "Low Growth",
      rampRates: [0, 0.30, 0.25, 0.20, 0.15, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02],
      stabilisedRate: 0.003,
    },
    Mid: {
      label: "Mid Growth",
      rampRates: [0, 0.50, 0.44, 0.32, 0.24, 0.14, 0.125, 0.08, 0.07, 0.045, 0.03, 0.03],
      stabilisedRate: 0.003,
    },
    High: {
      label: "High Growth",
      rampRates: [0, 0.70, 0.60, 0.45, 0.32, 0.20, 0.15, 0.12, 0.10, 0.07, 0.05, 0.04],
      stabilisedRate: 0.003,
    },
  },

  // 3×3 scenario matrix
  scenarios: [
    { id:"s1",  acquisition:"Low",  growth:"Low",  name:"Scenario 1", active:true,  isBase:true  },
    { id:"s2",  acquisition:"Low",  growth:"Mid",  name:"Scenario 2", active:true,  isBase:false },
    { id:"s3",  acquisition:"Low",  growth:"High", name:"Scenario 3", active:true,  isBase:false },
    { id:"s4",  acquisition:"Mid",  growth:"Low",  name:"Scenario 4", active:true,  isBase:false },
    { id:"s5",  acquisition:"Mid",  growth:"Mid",  name:"Scenario 5", active:true,  isBase:false },
    { id:"s6",  acquisition:"Mid",  growth:"High", name:"Scenario 6", active:true,  isBase:false },
    { id:"s7",  acquisition:"High", growth:"Low",  name:"Scenario 7", active:false, isBase:false },
    { id:"s8",  acquisition:"High", growth:"Mid",  name:"Scenario 8", active:false, isBase:false },
    { id:"s9",  acquisition:"High", growth:"High", name:"Scenario 9", active:false, isBase:false },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────
function addWeeks(dateStr, weeks) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split("T")[0];
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(str) {
  const d = parseDate(str);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtHours(open, close) {
  if (!open || !close) return "—";
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  const mins = (ch * 60 + cm) - (oh * 60 + om);
  return (mins / 60).toFixed(1) + "h";
}

const SEASON_MONTHS = {
  Winter: [11, 0, 1],   // Dec, Jan, Feb
  Spring: [2, 3, 4],    // Mar, Apr, May
  Summer: [5, 6, 7],    // Jun, Jul, Aug
  Fall:   [8, 9, 10],   // Sep, Oct, Nov
};
const SEASON_COLORS = {
  Winter: { bg: "#E8F0FF", text: "#3B5BDB", border: "#BAC8FF" },
  Spring: { bg: "#EBFBEE", text: "#2F9E44", border: "#B2F2BB" },
  Summer: { bg: "#FFF9DB", text: "#E67700", border: "#FFE066" },
  Fall:   { bg: CN.orangeLight, text: CN.orangeHover, border: "#FFBFA8" },
};
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getSeason(monthIndex) {
  for (const [s, months] of Object.entries(SEASON_MONTHS)) {
    if (months.includes(monthIndex)) return s;
  }
  return "Winter";
}

// Returns operating days in a calendar month for a given open date and schedule
function calcOperatingDays(year, monthIdx, openDate, schedule, holidaysPerYear) {
  const open = parseDate(openDate);
  if (!open) return { weekday: 0, saturday: 0, sunday: 0, total: 0 };

  let weekday = 0, saturday = 0, sunday = 0;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const avgHolidaysPerMonth = (holidaysPerYear || 6) / 12;

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, monthIdx, day);
    if (d < open) continue;
    const dow = d.getDay(); // 0=Sun, 1=Mon...6=Sat
    if (dow === 0) sunday++;
    else if (dow === 6) saturday++;
    else weekday++;
  }

  // Subtract average holidays from weekdays
  const effectiveWeekdays = Math.max(0, weekday - avgHolidaysPerMonth);

  const wdClosed = schedule?.weekday?.closed;
  const satClosed = schedule?.saturday?.closed;
  const sunClosed = schedule?.sunday?.closed;

  const totalDays = (wdClosed ? 0 : effectiveWeekdays) +
                    (satClosed ? 0 : saturday) +
                    (sunClosed ? 0 : sunday);

  return {
    weekday: wdClosed ? 0 : Math.round(effectiveWeekdays * 10) / 10,
    saturday: satClosed ? 0 : saturday,
    sunday: sunClosed ? 0 : sunday,
    total: Math.round(totalDays * 10) / 10,
  };
}

// Build 36-month calendar from open date
function buildCalendar(openDate, schedule, holidaysPerYear) {
  const open = parseDate(openDate);
  if (!open) return [];
  const months = [];
  for (let i = 0; i < 36; i++) {
    const d = new Date(open.getFullYear(), open.getMonth() + i, 1);
    const yr = d.getFullYear();
    const mo = d.getMonth();
    const season = getSeason(mo);
    const opDays = calcOperatingDays(yr, mo, openDate, schedule, holidaysPerYear);
    months.push({ year: yr, month: mo, label: MONTH_NAMES[mo] + " " + yr, season, opDays, periodNum: i + 1 });
  }
  return months;
}

// ── Primitives ────────────────────────────────────────────────────
const baseInp = {
  border: `1.5px solid ${CN.border}`, borderRadius: 8, padding: "7px 10px",
  fontSize: 13, fontFamily: "'Barlow Semi Condensed', sans-serif",
  color: CN.dark, backgroundColor: CN.white, outline: "none",
  boxSizing: "border-box",
};

function SectionCard({ title, subtitle, children, style = {} }) {
  return (
    <div style={{
      backgroundColor: CN.white, border: `1.5px solid ${CN.border}`,
      borderRadius: 14, marginBottom: 20, overflow: "hidden", ...style,
    }}>
      <div style={{
        padding: "16px 20px", borderBottom: `1px solid ${CN.border}`,
        backgroundColor: CN.cream,
      }}>
        <div style={{
          fontFamily: "'Bowlby One SC', sans-serif", fontSize: 14,
          textTransform: "uppercase", letterSpacing: "0.06em", color: CN.dark,
        }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: CN.mid, marginTop: 3 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

function FieldRow({ label, note, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.07em", color: CN.mid, display: "block", marginBottom: 5,
      }}>{label}</label>
      {children}
      {note && <div style={{ fontSize: 11, color: CN.mid, marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function Chip({ label, color = CN.mid, bg = CN.creamDark }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
      backgroundColor: bg, color, display: "inline-block",
    }}>{label}</span>
  );
}

function InfoBadge({ children, type = "info" }) {
  const styles = {
    info:    { bg: CN.creamDark, border: CN.border, text: CN.mid },
    warning: { bg: CN.amberLight, border: CN.amber, text: "#92400E" },
    success: { bg: CN.greenLight, border: CN.green, text: CN.green },
    alert:   { bg: CN.orangeLight, border: CN.orange, text: CN.orangeHover },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{
      backgroundColor: s.bg, border: `1px solid ${s.border}`, borderRadius: 8,
      padding: "9px 13px", fontSize: 12, color: s.text, marginBottom: 12,
    }}>{children}</div>
  );
}

// ── Timeline visual ───────────────────────────────────────────────
function Timeline({ handoverDate, constructionWeeks, openDate }) {
  const phases = [
    { label: "Site Handover", date: handoverDate, color: CN.amber, icon: "🔑" },
    { label: `Construction (${constructionWeeks}w)`, date: null, color: CN.mid, icon: "🏗️" },
    { label: "Soft Open", date: openDate, color: CN.orange, icon: "🍜" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0, marginTop: 4 }}>
      {phases.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", flex: i === 1 ? 2 : 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0, flex: 1 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", backgroundColor: p.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            }}>{p.icon}</div>
            <div style={{ textAlign: "center", marginTop: 8, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: CN.dark }}>{p.label}</div>
              {p.date && <div style={{ fontSize: 11, color: CN.mid, marginTop: 2 }}>{fmtDate(p.date)}</div>}
            </div>
          </div>
          {i < phases.length - 1 && (
            <div style={{
              flex: 1, height: 2, backgroundColor: CN.border, marginTop: 17,
              backgroundImage: i === 1 ? `repeating-linear-gradient(90deg,${CN.amber} 0,${CN.amber} 6px,transparent 6px,transparent 12px)` : "none",
            }}/>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Calendar preview ──────────────────────────────────────────────
function CalendarPreview({ months, seasonality }) {
  const [showAll, setShowAll] = useState(false);
  const displayMonths = showAll ? months : months.slice(0, 12);
  const maxDays = Math.max(...months.map(m => m.opDays.total), 1);

  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
        gap: 8,
      }}>
        {displayMonths.map((m, i) => {
          const sc = SEASON_COLORS[m.season];
          const seaMult = seasonality[m.season] || 1;
          const barW = Math.round((m.opDays.total / maxDays) * 100);
          return (
            <div key={i} style={{
              backgroundColor: i === 0 ? CN.orangeLight : sc.bg,
              border: `1.5px solid ${i === 0 ? CN.orange : sc.border}`,
              borderRadius: 10, padding: "10px 10px 8px", position: "relative",
            }}>
              {i === 0 && (
                <div style={{
                  position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)",
                  fontSize: 9, fontWeight: 800, backgroundColor: CN.orange, color: CN.white,
                  padding: "1px 7px", borderRadius: 99, whiteSpace: "nowrap",
                }}>OPEN</div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: CN.dark }}>{m.label}</div>
              <div style={{
                fontSize: 20, fontWeight: 800, color: i === 0 ? CN.orange : sc.text,
                fontFamily: "'Bowlby One SC', sans-serif", lineHeight: 1.2, marginTop: 4,
              }}>{m.opDays.total.toFixed(0)}</div>
              <div style={{ fontSize: 10, color: CN.mid }}>op. days</div>
              {/* Season multiplier bar */}
              <div style={{
                marginTop: 6, height: 3, backgroundColor: "rgba(0,0,0,0.08)", borderRadius: 2,
              }}>
                <div style={{
                  width: `${barW}%`, height: "100%", borderRadius: 2,
                  backgroundColor: i === 0 ? CN.orange : sc.text,
                }}/>
              </div>
              <div style={{ fontSize: 9, color: CN.mid, marginTop: 3 }}>
                {m.season} · {seaMult}×
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={() => setShowAll(v => !v)} style={{
        marginTop: 12, border: `1px solid ${CN.border}`, borderRadius: 8,
        backgroundColor: CN.white, color: CN.mid, fontSize: 12, fontWeight: 600,
        padding: "6px 14px", cursor: "pointer", fontFamily: "'Barlow Semi Condensed',sans-serif",
      }}>
        {showAll ? "Show first 12 months ↑" : `Show all ${months.length} months ↓`}
      </button>
    </div>
  );
}

// ── Scenario Matrix ───────────────────────────────────────────────
const ACQ_LEVELS = ["Low", "Mid", "High"];
const GROWTH_LEVELS = ["Low", "Mid", "High"];
const ACQ_COLORS = { Low: CN.blueLight, Mid: CN.amberLight, High: CN.greenLight };
const ACQ_TEXT = { Low: CN.blue, Mid: CN.amberDark, High: CN.green };

function ScenarioMatrix({ scenarios, onChange, acquisitionProfiles, growthProfiles }) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  const getScenario = (acq, growth) =>
    scenarios.find(s => s.acquisition === acq && s.growth === growth);

  const update = (id, patch) =>
    onChange(scenarios.map(s => s.id === id ? { ...s, ...patch } : s));

  const setBase = (id) =>
    onChange(scenarios.map(s => ({ ...s, isBase: s.id === id })));

  const startRename = (s) => { setRenamingId(s.id); setRenameVal(s.name); };
  const commitRename = () => {
    if (renameVal.trim()) update(renamingId, { name: renameVal.trim() });
    setRenamingId(null);
  };

  const baseScenario = scenarios.find(s => s.isBase);

  return (
    <div>
      <InfoBadge>
        The <strong>Base scenario</strong> is used as the reference point for variance analysis.
        Active scenarios will appear in all forecast views and comparisons.
      </InfoBadge>

      {/* Base scenario callout */}
      {baseScenario && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
          padding: "10px 14px", backgroundColor: CN.orangeLight,
          border: `1.5px solid ${CN.orange}`, borderRadius: 10,
        }}>
          <span style={{ fontSize: 18 }}>⭐</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: CN.orange }}>Base Scenario</div>
            <div style={{ fontSize: 13, color: CN.dark }}>{baseScenario.name} — {baseScenario.acquisition} Acquisition · {baseScenario.growth} Growth</div>
          </div>
        </div>
      )}

      {/* Matrix grid */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 6, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 100 }}/>
              {GROWTH_LEVELS.map(g => (
                <th key={g} style={{
                  padding: "8px 12px", fontSize: 11, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  color: CN.mid, textAlign: "center",
                }}>
                  {growthProfiles[g].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACQ_LEVELS.map(acq => (
              <tr key={acq}>
                <td style={{ padding: "4px 8px 4px 0", verticalAlign: "middle" }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: ACQ_TEXT[acq],
                    backgroundColor: ACQ_COLORS[acq], padding: "4px 10px",
                    borderRadius: 8, textAlign: "center",
                  }}>
                    {acquisitionProfiles[acq].label.replace(" Acquisition", "")} Acq
                  </div>
                  <div style={{ fontSize: 10, color: CN.mid, textAlign: "center", marginTop: 3 }}>
                    {acquisitionProfiles[acq].baseTransactions.toLocaleString()} tx/mo
                  </div>
                </td>
                {GROWTH_LEVELS.map(growth => {
                  const s = getScenario(acq, growth);
                  if (!s) return <td key={growth}/>;
                  return (
                    <td key={growth} style={{ padding: 0, verticalAlign: "top" }}>
                      <div style={{
                        border: `2px solid ${s.isBase ? CN.orange : s.active ? CN.border : CN.creamDark}`,
                        borderRadius: 12, padding: "12px 12px 10px",
                        backgroundColor: s.isBase ? CN.orangeLight : s.active ? CN.white : CN.creamDark,
                        opacity: s.active ? 1 : 0.55,
                        minWidth: 140, position: "relative",
                        transition: "all 0.15s",
                      }}>
                        {s.isBase && (
                          <div style={{
                            position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                            fontSize: 9, fontWeight: 800, backgroundColor: CN.orange,
                            color: CN.white, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap",
                          }}>BASE</div>
                        )}
                        {/* Name */}
                        {renamingId === s.id ? (
                          <input
                            autoFocus value={renameVal}
                            onChange={e => setRenameVal(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                            onBlur={commitRename}
                            style={{ ...baseInp, fontSize: 12, padding: "3px 6px", width: "100%", marginBottom: 6 }}
                          />
                        ) : (
                          <div style={{
                            fontSize: 12, fontWeight: 700, color: s.isBase ? CN.orange : CN.dark,
                            marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between",
                          }}>
                            <span>{s.name}</span>
                            <button onClick={() => startRename(s)} style={{
                              fontSize: 10, background: "none", border: "none", cursor: "pointer",
                              color: CN.mid, padding: "0 2px", lineHeight: 1,
                            }} title="Rename">✏️</button>
                          </div>
                        )}

                        {/* Tags */}
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 8 }}>
                          <Chip label={`${acq} Acq`} color={ACQ_TEXT[acq]} bg={ACQ_COLORS[acq]}/>
                          <Chip label={`${growth} Growth`} color={CN.mid} bg={CN.creamDark}/>
                        </div>

                        {/* Controls */}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            onClick={() => update(s.id, { active: !s.active })}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                              border: `1.5px solid ${s.active ? CN.border : CN.mid}`,
                              backgroundColor: s.active ? CN.creamDark : "transparent",
                              color: s.active ? CN.dark : CN.mid, cursor: "pointer",
                              fontFamily: "'Barlow Semi Condensed',sans-serif",
                            }}
                          >
                            {s.active ? "Active" : "Inactive"}
                          </button>
                          {!s.isBase && s.active && (
                            <button
                              onClick={() => setBase(s.id)}
                              style={{
                                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                                border: `1.5px solid ${CN.border}`, backgroundColor: "transparent",
                                color: CN.mid, cursor: "pointer",
                                fontFamily: "'Barlow Semi Condensed',sans-serif",
                              }}
                            >
                              Set Base
                            </button>
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

      <div style={{ marginTop: 12, fontSize: 11, color: CN.mid }}>
        {scenarios.filter(s => s.active).length} of {scenarios.length} scenarios active ·{" "}
        {scenarios.filter(s => s.active).length} will appear in forecast outputs.
      </div>
    </div>
  );
}

// ── Seasonality editor ────────────────────────────────────────────
function SeasonalityEditor({ seasonality, onChange }) {
  const seasons = ["Winter", "Spring", "Summer", "Fall"];
  const maxMult = Math.max(...Object.values(seasonality));

  return (
    <div>
      <InfoBadge>
        Multiplier applied to base transaction volume each month.
        1.0 = full rate · 0.8 = 80% of normal volume.
        Based on your spreadsheet's historical calibration.
      </InfoBadge>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {seasons.map(s => {
          const sc = SEASON_COLORS[s];
          const mult = seasonality[s];
          const barH = Math.round((mult / maxMult) * 80);
          return (
            <div key={s} style={{
              backgroundColor: sc.bg, border: `1.5px solid ${sc.border}`,
              borderRadius: 12, padding: "14px 14px 12px",
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: sc.text, marginBottom: 10 }}>{s}</div>
              {/* Visual bar */}
              <div style={{
                height: 80, display: "flex", alignItems: "flex-end",
                marginBottom: 10,
              }}>
                <div style={{
                  width: "100%", height: `${barH}%`, backgroundColor: sc.text,
                  borderRadius: "4px 4px 0 0", opacity: 0.7, minHeight: 4,
                  transition: "height 0.3s",
                }}/>
              </div>
              <input
                type="number" min="0.1" max="2" step="0.05"
                value={mult}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) onChange({ ...seasonality, [s]: v });
                }}
                style={{ ...baseInp, width: "100%", textAlign: "center", fontWeight: 700, fontSize: 16 }}
              />
              <div style={{ fontSize: 10, color: sc.text, textAlign: "center", marginTop: 4 }}>
                {Math.round(mult * 100)}% of base
              </div>
              <div style={{ fontSize: 10, color: CN.mid, textAlign: "center", marginTop: 2 }}>
                {SEASON_MONTHS[s].map(m => MONTH_NAMES[m]).join(", ")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Growth profile editor ─────────────────────────────────────────
function GrowthProfileEditor({ growthProfiles, onChange }) {
  const [expanded, setExpanded] = useState(null);
  const profiles = ["Low", "Mid", "High"];
  const profileColors = { Low: CN.blue, Mid: CN.amber, High: CN.green };
  const profileBgs = { Low: CN.blueLight, Mid: CN.amberLight, High: CN.greenLight };

  const updateRate = (profileKey, monthIdx, val) => {
    const p = growthProfiles[profileKey];
    const newRates = [...p.rampRates];
    newRates[monthIdx] = parseFloat(val) || 0;
    onChange({ ...growthProfiles, [profileKey]: { ...p, rampRates: newRates } });
  };

  const updateStabilised = (profileKey, val) => {
    const p = growthProfiles[profileKey];
    onChange({ ...growthProfiles, [profileKey]: { ...p, stabilisedRate: parseFloat(val) || 0 } });
  };

  return (
    <div>
      <InfoBadge>
        Month-on-month growth applied to transaction volume.
        Month 1 = opening month (rate is 0 — it's the base).
        After month 12, the stabilised rate applies indefinitely.
      </InfoBadge>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {profiles.map(pk => {
          const p = growthProfiles[pk];
          const isOpen = expanded === pk;
          const c = profileColors[pk];
          const bg = profileBgs[pk];
          const maxRate = Math.max(...p.rampRates.slice(1), 0.01);

          return (
            <div key={pk} style={{
              border: `1.5px solid ${isOpen ? c : CN.border}`,
              borderRadius: 12, overflow: "hidden",
              backgroundColor: isOpen ? CN.white : CN.creamDark,
              transition: "all 0.2s",
            }}>
              {/* Header */}
              <button onClick={() => setExpanded(isOpen ? null : pk)} style={{
                width: "100%", padding: "12px 14px", background: "none", border: "none",
                cursor: "pointer", textAlign: "left", display: "flex",
                justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: c }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: CN.mid, marginTop: 2 }}>
                    Peak: {Math.round(maxRate * 100)}% · Stabilised: {(p.stabilisedRate * 100).toFixed(1)}%/mo
                  </div>
                </div>
                <span style={{ fontSize: 11, color: CN.mid }}>{isOpen ? "▲" : "▼"}</span>
              </button>

              {/* Mini sparkline always visible */}
              <div style={{ padding: "0 14px 12px", display: "flex", gap: 2, alignItems: "flex-end", height: 32 }}>
                {p.rampRates.slice(1).map((r, i) => (
                  <div key={i} style={{
                    flex: 1, backgroundColor: bg, borderRadius: "2px 2px 0 0",
                    height: `${Math.round((r / maxRate) * 100)}%`, minHeight: 2,
                    border: `1px solid ${c}`, opacity: 0.6,
                  }}/>
                ))}
                {/* Stabilised indicator */}
                <div style={{
                  flex: 1, backgroundColor: c, borderRadius: "2px 2px 0 0",
                  height: `${Math.round((p.stabilisedRate / maxRate) * 100)}%`, minHeight: 2,
                  opacity: 0.4,
                }}/>
              </div>

              {/* Expanded rate editor */}
              {isOpen && (
                <div style={{ padding: "12px 14px 14px", borderTop: `1px solid ${CN.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: CN.mid, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Monthly growth rates</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                    {p.rampRates.map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: CN.mid, width: 40, flexShrink: 0 }}>Mo {i + 1}</span>
                        <input
                          type="number" step="0.01" min="0" max="2"
                          value={r}
                          disabled={i === 0}
                          onChange={e => updateRate(pk, i, e.target.value)}
                          style={{
                            ...baseInp, padding: "4px 6px", fontSize: 12,
                            width: "100%", textAlign: "right",
                            opacity: i === 0 ? 0.4 : 1,
                          }}
                        />
                        <span style={{ fontSize: 10, color: CN.mid, width: 16, flexShrink: 0 }}>×</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: CN.mid, flex: 1 }}>Stabilised rate (Mo 13+)</span>
                    <input
                      type="number" step="0.001" min="0" max="0.1"
                      value={p.stabilisedRate}
                      onChange={e => updateStabilised(pk, e.target.value)}
                      style={{ ...baseInp, padding: "4px 6px", fontSize: 12, width: 80, textAlign: "right" }}
                    />
                    <span style={{ fontSize: 10, color: CN.mid }}>×</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Acquisition profile editor ────────────────────────────────────
function AcquisitionEditor({ profiles, onChange }) {
  return (
    <div>
      <InfoBadge>
        Base transactions per month at opening day for each acquisition level.
        Derived from your market sizing model (Ridgefield households × capture rate).
      </InfoBadge>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {["Low", "Mid", "High"].map(pk => {
          const p = profiles[pk];
          const c = { Low: CN.blue, Mid: CN.amber, High: CN.green }[pk];
          const bg = { Low: CN.blueLight, Mid: CN.amberLight, High: CN.greenLight }[pk];
          return (
            <div key={pk} style={{
              backgroundColor: bg, border: `1.5px solid ${c}20`,
              borderRadius: 12, padding: "14px",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c, marginBottom: 8 }}>{p.label}</div>
              <div style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: CN.mid, display: "block", marginBottom: 4 }}>
                  Base Transactions/Month
                </label>
                <input
                  type="number" min="1" step="10"
                  value={p.baseTransactions}
                  onChange={e => onChange({ ...profiles, [pk]: { ...p, baseTransactions: parseInt(e.target.value) || 0 } })}
                  style={{ ...baseInp, width: "100%", fontWeight: 700, fontSize: 16, textAlign: "center" }}
                />
              </div>
              <div style={{ fontSize: 11, color: CN.mid }}>
                ≈ {(p.baseTransactions / 30).toFixed(0)} tx/day
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Save bar ──────────────────────────────────────────────────────
function SetupSaveBar({ dirty, onSave, onClear, saving }) {
  if (!dirty && !saving) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginTop: 24, paddingTop: 16, borderTop: `1.5px solid ${CN.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: CN.orange, fontWeight: 600 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: CN.orange, display: "inline-block" }}/>
        Unsaved changes
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClear} style={{
          padding: "7px 14px", border: `1.5px solid ${CN.border}`, borderRadius: 8,
          backgroundColor: CN.white, color: CN.mid, fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: "'Bowlby One SC',sans-serif", textTransform: "uppercase", letterSpacing: "0.06em",
        }}>Clear</button>
        <button onClick={onSave} disabled={saving} style={{
          padding: "7px 18px", border: "none", borderRadius: 8,
          backgroundColor: saving ? CN.creamDark : CN.orange,
          color: saving ? CN.mid : CN.white, fontSize: 12, fontWeight: 700,
          cursor: saving ? "default" : "pointer",
          fontFamily: "'Bowlby One SC',sans-serif", textTransform: "uppercase", letterSpacing: "0.06em",
          minWidth: 70,
        }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export function ForecastSetupTab({ setup, setSetup, savedSetup, onSave, onClear, saving, isMobile }) {
  const draft = setup || DEFAULT_FORECAST_SETUP;

  const openDate = useMemo(() => {
    if (!draft.handoverDate || !draft.constructionWeeks) return null;
    return addWeeks(draft.handoverDate, parseInt(draft.constructionWeeks) || 0);
  }, [draft.handoverDate, draft.constructionWeeks]);

  const months = useMemo(() => {
    if (!openDate) return [];
    return buildCalendar(openDate, draft.schedule, draft.holidaysPerYear);
  }, [openDate, draft.schedule, draft.holidaysPerYear]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedSetup);

  const set = (path, value) => {
    // Simple deep-set helper: path is a dot string e.g. "schedule.weekday.open"
    setSetup(prev => {
      const next = JSON.parse(JSON.stringify(prev || DEFAULT_FORECAST_SETUP));
      const keys = path.split(".");
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        marginBottom: 24, paddingBottom: 20, borderBottom: `1.5px solid ${CN.border}`,
        flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <h1 style={{
            fontFamily: "'Bowlby One SC',sans-serif", fontWeight: 800, fontSize: 28,
            textTransform: "uppercase", letterSpacing: "0.06em", color: CN.dark, margin: 0,
          }}>Forecast Setup</h1>
          <p style={{ fontSize: 13, color: CN.mid, marginTop: 4, margin: "4px 0 0" }}>
            Store calendar, scenario matrix, seasonality and growth profiles
          </p>
        </div>
      </div>

      {/* ── Section 1: Store Timeline ── */}
      <SectionCard
        title="Store Timeline"
        subtitle="Defines which months are active in the forecast"
      >
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 24px" }}>
          <FieldRow label="Site Handover Date" note="Date the landlord hands over the premises for fit-out">
            <input
              type="date" value={draft.handoverDate}
              onChange={e => set("handoverDate", e.target.value)}
              style={{ ...baseInp, width: "100%" }}
            />
          </FieldRow>
          <FieldRow label="Construction / Fit-out (weeks)" note="Weeks from handover to soft open. Currently 16 weeks.">
            <input
              type="number" min="1" max="52" step="1"
              value={draft.constructionWeeks}
              onChange={e => set("constructionWeeks", parseInt(e.target.value) || 0)}
              style={{ ...baseInp, width: "100%" }}
            />
          </FieldRow>
        </div>

        {openDate && (
          <div style={{ marginTop: 8 }}>
            <Timeline
              handoverDate={draft.handoverDate}
              constructionWeeks={draft.constructionWeeks}
              openDate={openDate}
            />
            <div style={{
              marginTop: 14, padding: "10px 14px", backgroundColor: CN.greenLight,
              border: `1px solid ${CN.green}`, borderRadius: 8, fontSize: 12, color: CN.green,
            }}>
              ✓ Soft open <strong>{fmtDate(openDate)}</strong> — forecast runs from{" "}
              <strong>{months[0]?.label}</strong> through{" "}
              <strong>{months[months.length - 1]?.label}</strong> ({months.length} months)
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Section 2: Operating Schedule ── */}
      <SectionCard
        title="Operating Schedule"
        subtitle="Trading hours by day type. Drives operating days and max revenue potential each month."
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
            <thead>
              <tr>
                {["Day Type", "Closed", "Open", "Close", "Daily Hours"].map(h => (
                  <th key={h} style={{
                    padding: "8px 10px", backgroundColor: CN.creamDark, border: `1px solid ${CN.border}`,
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em",
                    color: CN.mid, textAlign: h === "Closed" ? "center" : "left",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { key: "weekday", label: "Mon – Fri" },
                { key: "saturday", label: "Saturday" },
                { key: "sunday", label: "Sunday" },
              ].map(({ key, label }) => {
                const row = draft.schedule[key];
                return (
                  <tr key={key} style={{ backgroundColor: row.closed ? CN.creamDark : CN.white, opacity: row.closed ? 0.6 : 1 }}>
                    <td style={{ padding: "8px 10px", border: `1px solid ${CN.border}`, fontWeight: 600, color: CN.dark, fontSize: 13 }}>
                      {label}
                    </td>
                    <td style={{ padding: "8px 10px", border: `1px solid ${CN.border}`, textAlign: "center" }}>
                      <input
                        type="checkbox" checked={!!row.closed}
                        onChange={e => set(`schedule.${key}.closed`, e.target.checked)}
                        style={{ width: 15, height: 15, accentColor: CN.orange }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px", border: `1px solid ${CN.border}` }}>
                      <input
                        type="time" value={row.open} disabled={row.closed}
                        onChange={e => set(`schedule.${key}.open`, e.target.value)}
                        style={{ ...baseInp, width: 110, opacity: row.closed ? 0.4 : 1 }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px", border: `1px solid ${CN.border}` }}>
                      <input
                        type="time" value={row.close} disabled={row.closed}
                        onChange={e => set(`schedule.${key}.close`, e.target.value)}
                        style={{ ...baseInp, width: 110, opacity: row.closed ? 0.4 : 1 }}
                      />
                    </td>
                    <td style={{ padding: "8px 10px", border: `1px solid ${CN.border}`, fontWeight: 700, color: row.closed ? CN.mid : CN.orange, fontFamily: "'Bowlby One SC',sans-serif", fontSize: 15 }}>
                      {row.closed ? "Closed" : fmtHours(row.open, row.close)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14 }}>
          <FieldRow label="Federal Holidays per Year" note="Trading days lost to public holidays. Distributed evenly across weekdays.">
            <input
              type="number" min="0" max="20" step="1"
              value={draft.holidaysPerYear}
              onChange={e => set("holidaysPerYear", parseInt(e.target.value) || 0)}
              style={{ ...baseInp, width: 100 }}
            />
          </FieldRow>
        </div>
      </SectionCard>

      {/* ── Section 3: Calendar preview ── */}
      {months.length > 0 && (
        <SectionCard
          title="Operating Calendar"
          subtitle="Trading days per month based on your schedule. Basis for all volume and cost calculations."
        >
          <CalendarPreview months={months} seasonality={draft.seasonality} />
        </SectionCard>
      )}

      {/* ── Section 4: Seasonality ── */}
      <SectionCard
        title="Seasonality Multipliers"
        subtitle="Applied to base transaction volume monthly. Calibrated from your spreadsheet model."
      >
        <SeasonalityEditor
          seasonality={draft.seasonality}
          onChange={v => setSetup(prev => ({ ...(prev || DEFAULT_FORECAST_SETUP), seasonality: v }))}
        />
      </SectionCard>

      {/* ── Section 5: Scenario Matrix ── */}
      <SectionCard
        title="Scenario Matrix"
        subtitle="3×3 grid of Acquisition level × Growth profile. Activate the scenarios you want to model."
      >
        <ScenarioMatrix
          scenarios={draft.scenarios}
          acquisitionProfiles={draft.acquisitionProfiles}
          growthProfiles={draft.growthProfiles}
          onChange={s => setSetup(prev => ({ ...(prev || DEFAULT_FORECAST_SETUP), scenarios: s }))}
        />
      </SectionCard>

      {/* ── Section 6: Acquisition Profiles ── */}
      <SectionCard
        title="Acquisition Profiles"
        subtitle="Base transaction volume at opening month by acquisition level. Derived from Ridgefield market sizing."
      >
        <AcquisitionEditor
          profiles={draft.acquisitionProfiles}
          onChange={p => setSetup(prev => ({ ...(prev || DEFAULT_FORECAST_SETUP), acquisitionProfiles: p }))}
        />
      </SectionCard>

      {/* ── Section 7: Growth Profiles ── */}
      <SectionCard
        title="Growth Profiles"
        subtitle="Month-on-month transaction growth by profile. Click a profile to edit individual rates."
      >
        <GrowthProfileEditor
          growthProfiles={draft.growthProfiles}
          onChange={p => setSetup(prev => ({ ...(prev || DEFAULT_FORECAST_SETUP), growthProfiles: p }))}
        />
      </SectionCard>

      <SetupSaveBar dirty={dirty} onSave={onSave} onClear={onClear} saving={saving} />
      {isMobile && <div style={{ height: 70 }} />}
    </div>
  );
}
