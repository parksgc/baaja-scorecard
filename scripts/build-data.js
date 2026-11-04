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
vm.runInContext(dataJs + "\nthis.d = { SENATE, SEN_NOTES, SEN_LABEL };", ctx);
const { SENATE, SEN_NOTES, SEN_LABEL } = ctx.d;

const updated = (html.match(/Updated <strong>([^<]+)<\/strong>/) || [])[1] || "";
const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (rows) => rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const senators = SENATE.map((s) => {
  const key = s.name.replace(/ \(..\)$/, "");
  const n = SEN_NOTES[key];
  return { ...s, key, pos: n ? n[0] : "none", note: n ? plain(n[1]) : "" };
});

// 1. Path to 60: one stacked bar
const order = [["sponsor", "Sponsors"], ["support", "Other supporters"], ["lean", "Lean support"], ["conditional", "Conditions"], ["oppose", "Opposed"], ["none", "No statement found"]];
const count = (k) => senators.filter((s) => s.pos === k).length;
const bar = [["Senate", ...order.map(([, l]) => l)], [`Senate (updated ${updated})`, ...order.map(([k]) => count(k))]];

// 2. Map: one row per state
const NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
const yes = new Set(["sponsor", "support", "lean"]);
const label = (s) => SEN_LABEL[s.pos][0];
const map = [["State", "Code", "Map category", "Senator 1", "Senator 1 position", "Senator 2", "Senator 2 position"]];
for (const code of Object.keys(NAMES)) {
  const [a, b] = senators.filter((s) => s.state === code).sort((x, y) => x.key.localeCompare(y.key));
  const p = [a.pos, b.pos];
  const cat = p.includes("oppose") ? "At least one opposed"
    : p.includes("conditional") ? "Conditions or concerns"
    : p.every((x) => yes.has(x)) ? "Both support or lean support"
    : p.some((x) => yes.has(x)) ? "One supports, one no statement"
    : "No statement from either";
  map.push([NAMES[code], code, cat, `${a.key} (${a.party})`, label(a), `${b.key} (${b.party})`, label(b)]);
}

// 3. Senate table: senators on record
const rank = { sponsor: 0, support: 1, lean: 2, conditional: 3, oppose: 4, none: 5 };
const table = [["Senator", "Party", "State", "Position", "On the record"]];
senators.filter((s) => s.pos !== "none").sort((a, b) => rank[a.pos] - rank[b.pos] || a.key.localeCompare(b.key))
  .forEach((s) => table.push([s.key, s.party, s.state, label(s), s.note]));

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "path-to-60.csv"), csv(bar));
fs.writeFileSync(path.join(root, "data", "senate-by-state.csv"), csv(map));
fs.writeFileSync(path.join(root, "data", "senators-on-record.csv"), csv(table));
console.log(`Built data/ (updated ${updated}): ${senators.length - count("none")} senators on record, ${map.length - 1} states.`);
