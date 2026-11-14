// Builds the CSV files the Datawrapper charts read, from the data in index.html.
// Run after every change to index.html:  node scripts/build-data.js
// Output goes to data/, which GitHub Pages serves next to the page.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
// Evaluate only the data declarations (everything before the rendering helpers).
const dataJs = js.split("function srcLinks")[0].replace(/^if \(SUBSTACK_URL\)[\s\S]*?\n\}\n/m, "");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(dataJs + "\nthis.d = { SENATE, SEN_NOTES, HOUSE, CAUCUS_ROWS, secHref, BAAJA_SEC, POLLS, VOTES, AMENDMENTS, DEMANDS };", ctx);
const { SENATE, SEN_NOTES, HOUSE, CAUCUS_ROWS, secHref, BAAJA_SEC, POLLS, VOTES, AMENDMENTS, DEMANDS } = ctx.d;
// Amendment tracker: every senator named as a sponsor or cosponsor must be a senator on the page.
{
  const keys = new Set(SENATE.map((s) => s.name));
  const bad = [...AMENDMENTS.flatMap((a) => [...a.senators, ...a.cos]), ...DEMANDS.flatMap((d) => d.senators)].filter((n) => !keys.has(n));
  if (bad.length) throw new Error(`Amendment tracker names no such senator: ${[...new Set(bad)].join(", ")}`);
}
// Floor votes must name every senator on the page exactly once, by the page's own key, and nobody else.
for (const v of VOTES) {
  const keys = new Set(SENATE.map((s) => s.name));
  const missing = [...keys].filter((k) => !(k in v.votes));
  const extra = Object.keys(v.votes).filter((k) => !keys.has(k));
  const bad = Object.entries(v.votes).filter(([, x]) => !(x === "Y" || x === "N" || x === null)).map(([k]) => k);
  if (missing.length || extra.length || bad.length) throw new Error(`Vote ${v.id}: missing ${missing.join(", ") || "none"}; no such senator ${extra.join(", ") || "none"}; bad value ${bad.join(", ") || "none"}`);
}
// Same rule as the page: "Sec. 2301", "Secs. 1401–1402" link to BPC's section-by-section explainer.
const linkSecs = (t) => String(t).replace(/\b(Secs?\.|Sections?)(\s+)(\d{4})((?:\([^)\s]*\))*)(\s*[–-]\s*\d{4})?/g, (m, _w, _s, num, _sub, range) =>
  BAAJA_SEC(+num) ? `<a href="${secHref(num + (range || ""))}" target="_blank">${m}</a>` : m);

const updated = (html.match(/Updated <strong>([^<]+)<\/strong>/) || [])[1] || "";
const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (rows) => rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const senators = SENATE.map((s) => {
  const key = s.name.replace(/ \(..\)$/, "");
  const n = SEN_NOTES[key];
  const pos0 = n ? n[0] : "none";
  // Same rule as the page: a cloture yes vote moves a senator with no stated position into the light-green tier.
  const lastVote = VOTES[VOTES.length - 1].votes[s.name];
  const pos = (pos0 === "none" || pos0 === "lean" || pos0 === "supchg") && lastVote === "Y" ? "lean" : (pos0 === "none" || pos0 === "conditional") && lastVote === "N" ? "oppose" : pos0;
  return { ...s, key, pos, note: n ? plain(n[1]) : pos === "lean" ? "No statement on the bill found. Voted for cloture on the motion to proceed, Nov. 9." : pos === "oppose" ? "No statement on the bill found. Voted no on cloture on the motion to proceed, Nov. 9." : "" };
});

// One vocabulary for every chart, so the bar, the seat chart and the map read alike.
// Datawrapper keys its colors to these exact strings: rename one here and its color must be reset in Datawrapper.
// The seat chart's legend order follows Datawrapper's stored color map, which sorts keys by length and then
// alphabetically, so these lengths are chosen to keep the legend running from Sponsor to No statement found.
// "Supports, wants changes" (supchg) sorts after "No statement found" by length; the charts set categoryOrder to place it after "Leans support".
const LABEL = { sponsor: "Sponsor", support: "Supports", lean: "Voted for cloture", supchg: "Supports, wants changes", conditional: "Wants changes", oppose: "Opposes or voted no", none: "No statement found" };

// 1. Path to 60: one stacked bar
const order = ["sponsor", "support", "lean", "supchg", "conditional", "oppose", "none"].map((k) => [k, LABEL[k]]);
const count = (k) => senators.filter((s) => s.pos === k).length;
// Empty Senate tiers (since the Nov. 9 vote rules, "Supports, wants changes" and "Wants changes") drop out of the bar and its legend.
const barOrder = order.filter(([k]) => count(k) > 0 || ["sponsor", "support", "lean", "oppose", "none"].includes(k));
const bar = [["Senate", ...barOrder.map(([, l]) => l)], [`Senate (updated ${updated})`, ...barOrder.map(([k]) => count(k))]];

// 2. Map: one row per state
const NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
const yes = new Set(["sponsor", "support", "lean"]);
const label = (s) => LABEL[s.pos];
const map = [["State", "Code", "Map category", "Senator 1", "Senator 1 position", "Senator 2", "Senator 2 position"]];
for (const code of Object.keys(NAMES)) {
  const [a, b] = senators.filter((s) => s.state === code).sort((x, y) => x.key.localeCompare(y.key));
  const p = [a.pos, b.pos];
  const cat = p.includes("oppose") ? "At least one opposes"
    : p.includes("conditional") || p.includes("supchg") ? "Wants changes"
    : p.every((x) => yes.has(x)) ? "Both support or voted for cloture"
    : p.some((x) => yes.has(x)) ? "One supports or voted for cloture"
    : "No statement found";
  map.push([NAMES[code], code, cat, `${a.key} (${a.party})`, label(a), `${b.key} (${b.party})`, label(b)]);
}

// 3. Senate table: senators on record
const rank = { sponsor: 0, support: 1, lean: 2, supchg: 3, conditional: 4, oppose: 5, none: 6 };
const table = [["Senator", "Party", "State", "Position", "On the record"]];
senators.filter((s) => s.pos !== "none").sort((a, b) => rank[a.pos] - rank[b.pos] || a.key.localeCompare(b.key))
  .forEach((s) => table.push([s.key, s.party, s.state, label(s), s.note]));

// 4. Seat chart: one row per senator with x/y seat coordinates (same layout and order as the page's chart)
const byName = (a, b) => a.key.localeCompare(b.key);
const L = ["none", "oppose", "conditional", "supchg", "lean", "support", "sponsor"];
const grab = (party, p) => senators.filter((s) => s.party === party && s.pos === p).sort(byName);
const ordered = [
  ...L.flatMap((p) => grab("D", p)),
  ...L.flatMap((p) => grab("I", p)),
  ...[...L].reverse().flatMap((p) => grab("R", p)),
];
if (ordered.length !== 100) throw new Error(`Seat chart has ${ordered.length} senators, expected 100`);
const counts = [10, 13, 15, 18, 21, 23], radii = [120, 152, 184, 216, 248, 280];
const seats = [];
counts.forEach((n, i) => { for (let j = 0; j < n; j++) { const a = Math.PI - (Math.PI * j) / (n - 1); seats.push({ a, r: radii[i] }); } });
seats.sort((p, q) => q.a - p.a || p.r - q.r);
const PARTY = { D: "Democrat", R: "Republican", I: "Independent" };
const short = (t) => { if (!t) return "No statement found."; if (t.length <= 150) return t; const cut = t.slice(0, 150); return cut.slice(0, cut.lastIndexOf(" ")) + "…"; };
const seatRows = [["x", "y", "Senator", "Party", "State", "Position", "What they said"]];
const placed = ordered.map((s, k) => ({ s, ...seats[k] }));
// Row order only sets the legend order (positions come from x/y): strongest support first, silence last.
placed.sort((p, q) => rank[p.s.pos] - rank[q.s.pos]);
placed.forEach(({ s, a, r }) => {
  seatRows.push([(r * Math.cos(a)).toFixed(1), (r * Math.sin(a)).toFixed(1), `Sen. ${s.key}`, PARTY[s.party], s.state, label(s), linkSecs(short(s.note))]);
});

// 5. Latest stakeholder statements (outside groups only), newest first, for the Datawrapper table.
const latestSrc = js.slice(js.indexOf("const LATEST = ["), js.indexOf("\n];", js.indexOf("const LATEST = [")) + 3);
vm.runInContext(latestSrc.replace("const LATEST", "this.LATEST"), ctx);
const GROUP_POS = { support: ["Supports", "#3a9a74"], supchg: ["Supports, wants changes", "#3a9a74"], oppose: ["Opposes", "#b0452a"], changes: ["Wants changes", "#d9923a"], conditional: ["Wants changes", "#d9923a"] };
const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const day = (d) => { const [, m, dd] = d.split("-"); return `${MONTHS[+m - 1]} ${+dd}`; };
// First sentence only: the table is a pointer to the page, which has the full entry.
const firstSentence = (t) => { const m = t.match(/^.*?[a-z0-9)\]][.!?]["\u201d]?(?=\s+[A-Z])/); return m ? m[0] : t; };
const latestRows = [["Date", "Group", "What they said"]];
ctx.LATEST.filter((x) => x.k === "Group").sort((a, b) => b.d.localeCompare(a.d)).slice(0, 10).forEach((x) => {
  const [lab, col] = GROUP_POS[x.pos] || ["See page", "#5a6578"];
  const src = (x.src || []).map(([t, u]) => `<a href="${u}" target="_blank">${t}</a>`).join(" · ");
  latestRows.push([
    day(x.d),
    `<b>${x.who}</b><br><span style="color:${col};font-weight:600">● ${lab}</span>`,
    `${linkSecs(firstSentence(plain(x.text)))}<br><span style="color:#5a6578;font-size:12px">${src}</span>`,
  ]);
});


// 6. House: one row per seat (435), from the roster snapshot in scripts/house-roster.csv
// (unitedstates/congress-legislators, current members; blank rows are vacancies). Positions come from the
// page's HOUSE list, matched by state and district. Caucuses and members without a district are skipped.
const roster = fs.readFileSync(path.join(__dirname, "house-roster.csv"), "utf8").trim().split("\n").slice(1).map((l) => {
  const m = l.match(/^([A-Z]{2}),(\w+),("(?:[^"]|"")*"|[^,]*),([DRI]?)$/);
  if (!m) throw new Error(`Bad roster line: ${l}`);
  return { state: m[1], dist: m[2], name: m[3].replace(/^"|"$/g, "").replace(/""/g, '"'), party: m[4] };
});
if (roster.length !== 435) throw new Error(`House roster has ${roster.length} seats, expected 435`);
const houseNotes = {};
[...HOUSE, ...CAUCUS_ROWS].forEach(([who, where, pos, note]) => {
  const m = /^[RDI]-([A-Z]{2})-(\d+|AL)\b/.exec(where);
  const k = m && `${m[1]}-${m[2] === "AL" ? "AL" : +m[2]}`;
  if (m && !houseNotes[k]) houseNotes[k] = { who, pos, note: plain(note) };
});
const members = roster.map((r) => {
  const key = `${r.state}-${r.dist === "AL" ? "AL" : +r.dist}`;
  const n = houseNotes[key];
  if (n) delete houseNotes[key];
  return { ...r, key, pos: !r.party ? "vacant" : n ? n.pos : "none", note: n ? n.note : "", shown: n ? n.who : r.name };
});
const unmatched = Object.keys(houseNotes);
if (unmatched.length) throw new Error(`House entries with no roster seat: ${unmatched.join(", ")}`);
// "Seat currently vacant" is longer than "No statement found" so it sorts last in Datawrapper's legend (see LABEL note).
const HLABEL = { ...LABEL, lean: "Leans support", oppose: "Opposes outright", vacant: "Seat currently vacant", cs: "Caucus endorsed (no member statement)", co: "Caucus opposed (no member statement)" };
const HL = ["co", "none", "cs", "oppose", "conditional", "supchg", "lean", "support", "sponsor"];
const hgrab = (party, p) => members.filter((m) => m.party === party && m.pos === p).sort((a, b) => a.key.localeCompare(b.key));
const hOrdered = [
  ...HL.flatMap((p) => hgrab("D", p)),
  ...HL.flatMap((p) => hgrab("I", p)),
  ...[...HL].reverse().flatMap((p) => hgrab("R", p)),
  ...members.filter((m) => m.pos === "vacant"),
];
// Hemicycle: 12 rows, seats per row proportional to radius, summing to 435.
const hRadii = Array.from({ length: 12 }, (_, i) => 100 + i * 18.2);
const rsum = hRadii.reduce((a, b) => a + b, 0);
const hCounts = hRadii.map((r) => Math.floor((435 * r) / rsum));
for (let i = hCounts.length - 1; hCounts.reduce((a, b) => a + b, 0) < 435; i--) hCounts[i]++;
const hSeats = [];
hCounts.forEach((n, i) => { for (let j = 0; j < n; j++) hSeats.push({ a: Math.PI - (Math.PI * j) / (n - 1), r: hRadii[i] }); });
hSeats.sort((p, q) => q.a - p.a || p.r - q.r);
const HPARTY = { D: "Democrat", R: "Republican", I: "Independent", "": "Vacant" };
const hRank = { ...rank, cs: 7, co: 8, vacant: 9 };
const houseSeatRows = [["x", "y", "Member", "Party", "District", "Position", "What they said"]];
hOrdered.map((m, k) => ({ m, ...hSeats[k] })).sort((p, q) => hRank[p.m.pos] - hRank[q.m.pos]).forEach(({ m, a, r }) => {
  houseSeatRows.push([(r * Math.cos(a)).toFixed(1), (r * Math.sin(a)).toFixed(1), m.party ? `Rep. ${m.shown}` : "Seat currently vacant",
    HPARTY[m.party], `${m.state}-${m.dist}`, HLABEL[m.pos], m.party ? linkSecs(short(m.note)) : "Seat currently vacant."]);
});
// 7. Path to 218: one stacked bar, same vocabulary as the Senate bar.
const hcount = (k) => members.filter((m) => m.pos === k).length;
const hOrder = ["support", "lean", "supchg", "conditional", "oppose", "cs", "none", "vacant"];
// One bar for the whole House, then one per party, so readers can see the split at a glance.
const hcountP = (k, p) => members.filter((m) => m.pos === k && m.party === p).length;
const seatsP = (p) => members.filter((m) => m.party === p).length;
const bar218 = [["House", ...hOrder.map((k) => HLABEL[k])],
  [`Whole House (updated ${updated})`, ...hOrder.map(hcount)],
  [`Democrats (${seatsP("D")} seats)`, ...hOrder.map((k) => hcountP(k, "D"))],
  [`Republicans (${seatsP("R")} seats)`, ...hOrder.map((k) => hcountP(k, "R"))]];
if (members.some((m) => m.party === "I" && m.pos !== "none")) throw new Error("An independent House member is on record: add an Independents row to path-to-218");

// 7b. House members on record, by party, for a Datawrapper table. Caucus-shaded members are left out (not counted).
const HPOS_ORDER = { support: 0, lean: 1, supchg: 2, conditional: 3, oppose: 4 };
const houseRecord = [["Party", "Member", "District", "Position", "What they said"]];
members.filter((m) => m.pos in HPOS_ORDER)
  .sort((a, b) => HPOS_ORDER[a.pos] - HPOS_ORDER[b.pos] || (a.party === b.party ? 0 : a.party === "D" ? -1 : 1) || a.shown.localeCompare(b.shown))
  .forEach((m) => houseRecord.push([HPARTY[m.party], `Rep. ${m.shown}`, `${m.party}-${m.state}-${m.dist}`, HLABEL[m.pos], linkSecs(short(m.note))]));

// 8. Polls: one row per question stage, for a Datawrapper chart of how support moves as respondents hear more.
const pollRows = [["Poll", "Released", "Fielded", "Sample", "Sponsor stance", "Stage", "Support", "Oppose", "Source"]];
for (const p of POLLS) p.stages.forEach(([label, y, n]) => pollRows.push([`${p.pollster} for ${p.sponsor}`, p.released, p.field, `${p.n} ${p.pop}`, p.sponsorPos, label, y, n == null ? "" : n, p.src[0][1]]));

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "latest-statements.csv"), csv(latestRows));
fs.writeFileSync(path.join(root, "data", "senate-seats.csv"), csv(seatRows));
fs.writeFileSync(path.join(root, "data", "path-to-60.csv"), csv(bar));
fs.writeFileSync(path.join(root, "data", "senate-by-state.csv"), csv(map));
fs.writeFileSync(path.join(root, "data", "senators-on-record.csv"), csv(table));
fs.writeFileSync(path.join(root, "data", "house-seats.csv"), csv(houseSeatRows));
fs.writeFileSync(path.join(root, "data", "path-to-218.csv"), csv(bar218));
fs.writeFileSync(path.join(root, "data", "house-on-record.csv"), csv(houseRecord));
const amendRows = [["Amendment", "Sponsor", "What it would do", "Status", "Cosponsors", "Evidence tier"],
  ...AMENDMENTS.map((a) => [a.id, a.sponsor, plain(a.what), plain(a.status), a.cos.length ? `${a.cos.length}: ${a.cos.join(", ")}` : "", String(a.tier)])];
fs.writeFileSync(path.join(root, "data", "amendments.csv"), csv(amendRows));
fs.writeFileSync(path.join(root, "data", "polls.csv"), csv(pollRows));
console.log(`Built data/ (updated ${updated}): ${senators.length - count("none")} senators on record, ${map.length - 1} states; House ${members.filter((m) => !["none", "vacant", "cs", "co"].includes(m.pos)).length} on record (+${hcount("cs")} caucus-shaded), ${hcount("vacant")} vacant.`);
