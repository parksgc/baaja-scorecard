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
vm.runInContext(dataJs + "\nthis.d = { SENATE, SEN_NOTES };", ctx);
const { SENATE, SEN_NOTES } = ctx.d;

const updated = (html.match(/Updated <strong>([^<]+)<\/strong>/) || [])[1] || "";
const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (rows) => rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const senators = SENATE.map((s) => {
  const key = s.name.replace(/ \(..\)$/, "");
  const n = SEN_NOTES[key];
  return { ...s, key, pos: n ? n[0] : "none", note: n ? plain(n[1]) : "" };
});

// One vocabulary for every chart, so the bar, the seat chart and the map read alike.
// Datawrapper keys its colors to these exact strings: rename one here and its color must be reset in Datawrapper.
// The seat chart's legend order follows Datawrapper's stored color map, which sorts keys by length and then
// alphabetically, so these lengths are chosen to keep the legend running from Sponsor to No statement found.
const LABEL = { sponsor: "Sponsor", support: "Supports", lean: "Leans support", conditional: "Wants changes", oppose: "Opposes outright", none: "No statement found" };

// 1. Path to 60: one stacked bar
const order = ["sponsor", "support", "lean", "conditional", "oppose", "none"].map((k) => [k, LABEL[k]]);
const count = (k) => senators.filter((s) => s.pos === k).length;
const bar = [["Senate", ...order.map(([, l]) => l)], [`Senate (updated ${updated})`, ...order.map(([k]) => count(k))]];

// 2. Map: one row per state
const NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
const yes = new Set(["sponsor", "support", "lean"]);
const label = (s) => LABEL[s.pos];
const map = [["State", "Code", "Map category", "Senator 1", "Senator 1 position", "Senator 2", "Senator 2 position"]];
for (const code of Object.keys(NAMES)) {
  const [a, b] = senators.filter((s) => s.state === code).sort((x, y) => x.key.localeCompare(y.key));
  const p = [a.pos, b.pos];
  const cat = p.includes("oppose") ? "At least one opposes"
    : p.includes("conditional") ? "Wants changes"
    : p.every((x) => yes.has(x)) ? "Both support or lean"
    : p.some((x) => yes.has(x)) ? "One supports or leans"
    : "No statement found";
  map.push([NAMES[code], code, cat, `${a.key} (${a.party})`, label(a), `${b.key} (${b.party})`, label(b)]);
}

// 3. Senate table: senators on record
const rank = { sponsor: 0, support: 1, lean: 2, conditional: 3, oppose: 4, none: 5 };
const table = [["Senator", "Party", "State", "Position", "On the record"]];
senators.filter((s) => s.pos !== "none").sort((a, b) => rank[a.pos] - rank[b.pos] || a.key.localeCompare(b.key))
  .forEach((s) => table.push([s.key, s.party, s.state, label(s), s.note]));

// 4. Seat chart: one row per senator with x/y seat coordinates (same layout and order as the page's chart)
const byName = (a, b) => a.key.localeCompare(b.key);
const L = ["none", "oppose", "conditional", "lean", "support", "sponsor"];
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
  seatRows.push([(r * Math.cos(a)).toFixed(1), (r * Math.sin(a)).toFixed(1), `Sen. ${s.key}`, PARTY[s.party], s.state, label(s), short(s.note)]);
});

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "senate-seats.csv"), csv(seatRows));
fs.writeFileSync(path.join(root, "data", "path-to-60.csv"), csv(bar));
fs.writeFileSync(path.join(root, "data", "senate-by-state.csv"), csv(map));
fs.writeFileSync(path.join(root, "data", "senators-on-record.csv"), csv(table));
console.log(`Built data/ (updated ${updated}): ${senators.length - count("none")} senators on record, ${map.length - 1} states.`);
