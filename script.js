// =====================================================================
//  GOOGLE SCRIPT SETTINGS  (only 2 lines to change later)
//
//  1) SCRIPT_URL            -> paste your Google Apps Script "Web app" URL here
//  2) USE_DUMMY_RESPONSE    -> true  = pretend the script answered "success" (testing)
//                              false = wait for the REAL answer from your script
//
//  The success message ("Booking done" / "Feedback sent") is shown ONLY when the
//  answer is { status: "success" }. Any other answer shows an error message.
// =====================================================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzXD709hyjcYCq1e9m01YlokQXrVxYkUFgYnJIdKkw-Pg4ST00Khei_d2FLgrjzy4azwg/exec";
const USE_DUMMY_RESPONSE = false;   // <-- change to false when your Google Script is ready
const DUMMY_SHOULD_FAIL = true;   // testing only: true = dummy answer is "error"

const LIMIT = 3;
let C = {}, openKey = null, query = "", type = "appointment", rating = 0, reviews = [];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const match = (o, q) => !q || JSON.stringify(o).toLowerCase().includes(q.toLowerCase());
const stars = n => '<i class="fa-solid fa-star"></i>'.repeat(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// local date as YYYY-MM-DD (toISOString() is UTC and can show "yesterday" in India early morning)
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyDate = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";

fetch("config.json").then(r => r.json()).then(d => { C = d; init(); }).catch(e => {
  console.error("Config error", e);
  document.body.insertAdjacentHTML("afterbegin", '<p style="padding:14px;background:#fee2e2;color:#991b1b;text-align:center">Could not load config.json. Open this site through a web server (e.g. VS Code Live Server), not by double-clicking the file.</p>');
});

function init() {
  const L = C.labInfo, H = C.homeServices;
  document.title = `${L.name} | ${L.tagline}`;
  [["brand-name", L.name], ["foot-name", L.name], ["f-name", L.name], ["brand-tag", L.tagline], ["top-phone", L.phone], ["c-phone", L.phone], ["f-phone", L.phone],
   ["top-email", L.email], ["c-mail", L.email], ["f-mail", L.email], ["top-hours", L.workingHours], ["c-hours", L.workingHours], ["f-hours", L.workingHours],
   ["c-addr", L.address], ["f-addr", L.address], ["accred", L.accreditation], ["hero-title", C.hero.title], ["hero-sub", C.hero.subtitle], ["f-about", C.footer.about], ["year", new Date().getFullYear()]]
    .forEach(([id, t]) => $(id).textContent = t);
  $("top-phone").href = "tel:" + L.phone; $("f-call").href = "tel:" + L.phone;
  $("wa").href = $("f-wa").href = `https://wa.me/91${L.whatsapp}?text=${encodeURIComponent("Hello, I need help with a lab test")}`;
  $("map").src = L.googleMaps.embedUrl; $("directions").href = L.googleMaps.locationUrl;
  const soc = Object.entries(L.socialMedia).map(([k, u]) => `<a class="s" href="${u}" target="_blank" rel="noopener" aria-label="${k}"><i class="fa-brands fa-${k === "twitter" ? "x-twitter" : k}"></i></a>`).join("");
  $("socials").innerHTML = $("f-socials").innerHTML = soc;
  $("f-badges").innerHTML = C.footer.badges.map(b => `<span><i class="fa-solid fa-circle-check"></i> ${b}</span>`).join("");
  $("stats").innerHTML = C.stats.map(s => `<div class="stat"><i class="fa-solid ${s.icon}"></i><h3>${s.count}</h3><p>${s.label}</p></div>`).join("");
  $("cats").innerHTML = C.testCategories.map(c => `<button data-q="${esc(c.name)}"><i class="fa-solid ${c.icon}"></i> ${c.name}</button>`).join("");
  $("tabs").innerHTML = C.services.map(s => `<button class="tab" data-tab="${s.type}"><i class="fa-solid ${s.icon}"></i>${s.title}</button>`).join("");

  // Home Services: 2 cards, each with its own background image (set "image" in config.json)
  $("home-grid").innerHTML = [
    ["sampleCollection", "home", "fa-house-medical", `Areas served (PIN): ${H.sampleCollection.pincodesServed.join(", ")}`],
    ["doctorVisit", "doctorvisit", "fa-user-doctor", "Ideal for elderly &amp; bed-ridden patients"]
  ].map(([k, t, i, x]) => `<div class="card svc" style="--img:url('${H[k].image || ""}')"><div class="svc-in"><span class="svc-ic"><i class="fa-solid ${i}"></i></span><h3>${H[k].title}</h3><p class="svc-txt">${H[k].description}</p><b class="svc-price">${H[k].fee}</b><p class="svc-note">${x}</p><button class="btn btn-light" data-book="${t}"><i class="fa-solid fa-calendar-check"></i> Book Now</button></div></div>`).join("");

  try { reviews = JSON.parse(localStorage.getItem("labReviews") || "[]"); } catch { reviews = []; }
  reviews = reviews.concat(C.testimonials);
  slideshow(); renderReviews(); render(); setType("appointment"); bind();
}

// Hero: auto-changing background images
function slideshow() {
  const imgs = C.hero.bgImages || [C.hero.bgImage], bg = $("hero-bg"); let i = 0, t;
  bg.innerHTML = imgs.map(u => `<div class="slide" style="background-image:url('${u}')"></div>`).join("");
  $("dots").innerHTML = imgs.map((_, k) => `<button aria-label="Slide ${k + 1}"></button>`).join("");
  const go = n => { i = n; [...bg.children].forEach((s, k) => s.classList.toggle("on", k === i)); [...$("dots").children].forEach((d, k) => d.classList.toggle("on", k === i)); clearInterval(t); t = setInterval(() => go((i + 1) % imgs.length), 5500); };
  [...$("dots").children].forEach((d, k) => d.onclick = () => go(k));
  go(0);
}

// Cards for each collapsible list
const LISTS = {
  packages: { noun: "packages", data: () => C.packages.filter(p => match(p, query)), card: p => `<div class="card"><div class="img"><img src="${p.image}" alt="${esc(p.name)}" loading="lazy"><span class="tag">${p.discount}</span></div><div class="body"><span class="badge">${p.badge}</span><h3>${p.name}</h3><p class="meta"><i class="fa-solid fa-vial"></i> ${p.parameters}</p><div><span class="price">${p.price}</span><span class="old">${p.oldPrice}</span></div><div class="acts"><button class="btn btn-outline" data-pkg="${p.id}">View Details</button><button class="btn btn-primary" data-book="appointment" data-item="pkg:${p.id}">Book</button></div></div></div>` },
  doctors: { noun: "doctors", data: () => C.doctors.filter(d => match(d, query)), card: d => `<div class="card"><div class="img"><img src="${d.image}" alt="${esc(d.name)}" loading="lazy"></div><div class="body"><span class="badge">${d.specialty}</span><h3>${d.name}</h3><p class="meta">${d.qualifications} &bull; ${d.experience}</p><p class="meta"><i class="fa-regular fa-clock"></i> ${d.availability}</p><b class="price">${d.fee}</b><div class="acts"><button class="btn btn-outline" data-doc="${d.id}">View Details</button><button class="btn btn-primary" data-book="appointment" data-item="doc:${d.id}">Book</button></div></div></div>` },
  videos: { noun: "videos", data: () => C.videos, card: v => `<a class="card" href="${v.videoUrl}" target="_blank" rel="noopener"><div class="img"><img src="${v.thumbnail}" alt="" loading="lazy"><span class="tag"><i class="fa-solid fa-play"></i> Watch</span></div><div class="body"><h3>${v.title}</h3></div></a>` },
  blogs: { noun: "articles", data: () => C.blogs, card: b => `<a class="card" href="${b.link || "#blogs"}"><div class="img"><img src="${b.image}" alt="" loading="lazy"></div><div class="body"><span class="badge">${b.date} &bull; ${b.author}</span><h3>${b.title}</h3><p class="meta">${b.excerpt}</p></div></a>` }
};

// Only one "view more" list can be open at a time
function render() {
  Object.entries(LISTS).forEach(([k, L]) => {
    const arr = L.data(), full = openKey === k || (query && (k === "packages" || k === "doctors"));
    $(k + "-grid").innerHTML = (full ? arr : arr.slice(0, LIMIT)).map(L.card).join("") || `<p class="meta">No matches found.</p>`;
    const b = $("more-" + k); b.classList.toggle("hide", arr.length <= LIMIT || (query && (k === "packages" || k === "doctors")));
    b.textContent = openKey === k ? "Show less" : `View more ${L.noun} (${arr.length - LIMIT})`;
  });
}

// Reviews are shown ONLY in the Feedback section (one list, no duplicate)
function renderReviews() {
  const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
  $("avg").innerHTML = `<b>${avg}</b> <i class="fa-solid fa-star"></i> from ${reviews.length} reviews`;
  $("reviews").innerHTML = reviews.map(r => `<div class="review"><div>${stars(r.rating)}</div><p>${esc(r.text)}</p><b class="meta">— ${esc(r.name)}</b> <small>${esc(r.date || "")}</small></div>`).join("");
}

// ---------- Inline booking
function setType(t, item = "") {
  type = t; $("success").classList.add("hide"); $("book-form").classList.remove("hide"); $("m-alert").className = "alert";
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  const S = C.homeServices.sampleCollection, today = localISO();
  const f = (n, l, ty = "text", x = "") => `<label>${l}<input name="${n}" type="${ty}" ${x}></label>`;
  const pk = C.packages.map(p => `<option value="pkg:${p.id}">${p.name} — ${p.price}</option>`).join("");
  const dc = C.doctors.map(d => `<option value="doc:${d.id}">${d.name} (${d.specialty}) — ${d.fee}</option>`).join("");
  let h = "";
  // "Lab test / package / doctor" field: only for Appointment (test, package or doctor) and Doctor Home Visit (doctor).
  // Hidden completely for Home Sample Collection.
  if (t === "appointment") h += `<label>Lab test / package / doctor *<select name="item" id="item-sel" required><option value="">Select</option><optgroup label="Health Packages / Lab Tests">${pk}</optgroup><optgroup label="Doctors">${dc}</optgroup></select></label>`;
  if (t === "doctorvisit") h += `<label>Doctor *<select name="item" id="item-sel" required><option value="">Select</option>${dc}</select></label>`;
  h += `<div class="two-f">${f("date", "Date *", "date", `required min="${today}"`)}<label>Preferred time *<select name="slot">${S.timeSlots.map(s => `<option>${s}</option>`).join("")}</select></label></div>`;
  h += `<div class="two-f">${f("name", "Full name *", "text", 'required autocomplete="name"')}${f("phone", "Mobile *", "tel", 'required pattern="[0-9]{10}" maxlength="10" inputmode="numeric" autocomplete="tel" placeholder="10-digit number"')}</div>${f("email", "Email *", "email", 'required autocomplete="email"')}`;
  if (t !== "appointment") h += `<label>Full address *<textarea name="address" rows="2" required placeholder="House no, street, area"></textarea></label>${f("pincode", "PIN code *", "text", 'required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" id="pin"')}<div class="muted" id="pin-hint"></div>`;
  h += t === "home"
    ? `<label>Tests required / notes<textarea name="enquiry" rows="3" placeholder="e.g. CBC, HbA1c, Thyroid profile — or any special request"></textarea></label>`
    : `<label>Your enquiry<textarea name="enquiry" rows="3" placeholder="Any question or special request..."></textarea></label>`;
  $("m-fields").innerHTML = h;
  const sel = $("item-sel"); if (sel) { sel.value = item; sel.onchange = renderSummary; }
  const pin = $("pin"); if (pin) pin.oninput = () => { const ok = S.pincodesServed.includes(pin.value); $("pin-hint").innerHTML = pin.value.length < 6 ? "" : ok ? '<span style="color:#16a34a">✓ We serve this area</span>' : "We may not cover this PIN — we will confirm by call."; };
  renderSummary();
}

function renderSummary() {
  const sel = $("item-sel"), [k, id] = (sel ? sel.value : "").split(":"), S = C.homeServices;
  const info = { appointment: `<b>Lab hours:</b> ${C.labInfo.workingHours}<br>Walk-ins welcome. Carry your prescription.`, home: `<b>Collection fee:</b> ${S.sampleCollection.fee}<br>Slots: ${S.sampleCollection.timeSlots.join(" • ")}`, doctorvisit: `<b>Visit fee:</b> ${S.doctorVisit.fee}<br>Ideal for elderly or bed-ridden patients.` }[type];
  let h = "";
  if (k === "pkg") { const p = C.packages.find(x => x.id === id); h = `<div class="sum"><img src="${p.image}" alt=""><span class="badge">Selected package</span><h3>${p.name}</h3><div><span class="price">${p.price}</span><span class="old">${p.oldPrice}</span> <span class="badge">${p.discount}</span></div><p class="meta">Tests included (${p.testsIncluded.length}):</p><ul>${p.testsIncluded.map(t => `<li><i class="fa-solid fa-circle-check"></i>${t}</li>`).join("")}</ul></div>`; }
  else if (k === "doc") { const d = C.doctors.find(x => x.id === id); h = `<div class="sum"><img src="${d.image}" alt=""><span class="badge">${d.specialty}</span><h3>${d.name}</h3><p class="meta">${d.qualifications} • ${d.experience}</p><p class="meta"><i class="fa-regular fa-clock"></i> ${d.availability}</p><b class="price">Fee ${d.fee}</b></div>`; }
  else if (type === "home") h = `<div class="sum"><img src="${S.sampleCollection.image || ""}" alt=""><h3>${S.sampleCollection.title}</h3><p class="meta">${S.sampleCollection.description}</p></div>`;
  else h = `<div class="sum"><h3>Your booking summary</h3><p class="meta">Select a ${type === "doctorvisit" ? "doctor" : "package or doctor"} to see the details here.</p></div>`;
  $("summary").innerHTML = h + `<div class="info">${info}</div>`;
}

function goBook(t, item) { setType(t, item); $("booking").scrollIntoView({ behavior: "smooth" }); }

function bind() {
  $("burger").onclick = () => $("nav").classList.toggle("open");
  document.querySelectorAll("nav a").forEach(a => a.onclick = () => $("nav").classList.remove("open"));
  $("search").oninput = e => { const was = query; query = e.target.value.trim(); render(); if (query && !was) $("packages").scrollIntoView(); };
  $("cats").onclick = e => { const b = e.target.closest("button"); if (b) { $("search").value = query = b.dataset.q.split(" ")[0]; render(); $("packages").scrollIntoView({ behavior: "smooth" }); } };
  Object.keys(LISTS).forEach(k => $("more-" + k).onclick = () => { const y = $("more-" + k).getBoundingClientRect().top; openKey = openKey === k ? null : k; render(); window.scrollBy(0, $("more-" + k).getBoundingClientRect().top - y); });
  $("stars").onclick = e => { const s = e.target.dataset.s; if (!s) return; rating = +s; [...$("stars").children].forEach((b, i) => b.classList.toggle("on", i < rating)); };
  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-close]") || t.id === "drawer-o") $("drawer-o").classList.remove("open");
    const bk = t.closest("[data-book]"); if (bk) { e.preventDefault(); $("drawer-o").classList.remove("open"); goBook(bk.dataset.book, bk.dataset.item || ""); }
    const tb = t.closest("[data-tab]"); if (tb) setType(tb.dataset.tab);
    const p = t.closest("[data-pkg]"); if (p) openPackage(p.dataset.pkg);
    const d = t.closest("[data-doc]"); if (d) openDoctor(d.dataset.doc);
  });
  $("book-form").onsubmit = onBook; $("feedback-form").onsubmit = onFeedback;

  // Go-to-top floating button (sits above the WhatsApp button)
  const tt = $("totop"), toggle = () => tt.classList.toggle("show", window.scrollY > 400);
  window.addEventListener("scroll", toggle, { passive: true }); toggle();
  tt.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPackage(id) {
  const p = C.packages.find(x => x.id === id);
  $("drawer-body").innerHTML = `<span class="badge">${p.badge}</span><h2>${p.name}</h2><img src="${p.image}" alt=""><div><span class="price">${p.price}</span><span class="old">${p.oldPrice}</span> <span class="badge">${p.discount}</span></div><h4 style="margin-top:14px">Tests included (${p.testsIncluded.length})</h4><ul>${p.testsIncluded.map(t => `<li><i class="fa-solid fa-circle-check"></i>${t}</li>`).join("")}</ul><button class="btn btn-primary btn-block" data-book="appointment" data-item="pkg:${p.id}">Book this package</button>`;
  $("drawer-o").classList.add("open");
}
function openDoctor(id) {
  const d = C.doctors.find(x => x.id === id);
  $("drawer-body").innerHTML = `<span class="badge">${d.specialty}</span><h2>${d.name}</h2><img src="${d.image}" alt=""><ul><li><i class="fa-solid fa-graduation-cap"></i>${d.qualifications}</li><li><i class="fa-solid fa-award"></i>${d.experience}</li><li><i class="fa-regular fa-clock"></i>${d.availability}</li><li><i class="fa-solid fa-indian-rupee-sign"></i>Consultation fee ${d.fee}</li></ul><button class="btn btn-primary btn-block" data-book="appointment" data-item="doc:${d.id}">Book appointment</button><button class="btn btn-outline btn-block" style="margin-top:10px" data-book="doctorvisit" data-item="doc:${d.id}">Request home visit</button>`;
  $("drawer-o").classList.add("open");
}

// ---------- Sending data to Google Apps Script
// Always returns { status: "success" | "error", message, ref }
const hasScriptUrl = () => SCRIPT_URL && !SCRIPT_URL.includes("YOUR_GOOGLE");

async function send(data) {
  data.timestamp = new Date().toISOString();
  console.log("%cData sent to Google Script:", "color:#0e7490;font-weight:bold", data);

  // A) Dummy answer (testing). If SCRIPT_URL is filled, the data is still POSTed to your script,
  //    but the answer is ignored and "success" is returned.
  if (USE_DUMMY_RESPONSE) {
    if (hasScriptUrl()) {
      fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(data) }).catch(() => { });
    }
    await sleep(1000);
    const dummy = DUMMY_SHOULD_FAIL ? { status: "error", message: "Dummy error (test)" } : { status: "success", message: "Dummy success (test)", ref: data.ref };
    console.log("%cDummy answer from Google Script:", "color:#16a34a;font-weight:bold", dummy);
    return dummy;
  }

  // B) REAL answer from your Google Script
  if (!hasScriptUrl()) throw new Error("SCRIPT_URL is not set");
  const r = await fetch(SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const res = await r.json();
  console.log("%cAnswer from Google Script:", "color:#16a34a;font-weight:bold", res);
  return res;
}

async function onBook(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target)), [k, id] = (fd.item || "").split(":");
  let item, itemType, service;
  if (type === "home") { item = "Home Sample Collection"; itemType = "Home Collection"; service = "Home Sample Collection"; }
  else if (k === "pkg") { item = C.packages.find(x => x.id === id)?.name; itemType = "Package / Lab Test"; service = "Lab Test / Package Booking"; }
  else { item = C.doctors.find(x => x.id === id)?.name; itemType = "Doctor"; service = type === "doctorvisit" ? "Doctor Home Visit" : "Doctor Appointment"; }
  const now = new Date(), ref = "AK" + Date.now().toString().slice(-6);
  const d = {
    ref, type, service, itemType, item,
    date: fd.date, dateFormatted: prettyDate(fd.date), slot: fd.slot,     // visit / appointment date
    name: fd.name, phone: fd.phone, email: fd.email,
    address: fd.address || "", pincode: fd.pincode || "", enquiry: fd.enquiry || "",
    bookedOn: localISO(now)                                              // the day the booking was made
  };
  const btn = $("m-submit"), old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; $("m-alert").className = "alert";
  try {
    const res = await send(d);
    if (res.status !== "success") throw new Error(res.message || "Server said no");
    showSuccess(d);
    e.target.reset();
  } catch (err) {
    console.error(err);
    $("m-alert").textContent = "Booking could not be sent. Please try again or call us on " + C.labInfo.phone + ".";
    $("m-alert").className = "alert err";
  }
  btn.disabled = false; btn.innerHTML = old;
}

function showSuccess(d) {
  const headline = {
    "Package / Lab Test": `Your lab test / package <b>${esc(d.item)}</b> is booked`,
    "Doctor": d.type === "doctorvisit" ? `Your home visit by <b>${esc(d.item)}</b> is booked` : `Your appointment with <b>${esc(d.item)}</b> is booked`,
    "Home Collection": `Your <b>Home Sample Collection</b> is booked`
  }[d.itemType];
  const row = (i, l, v) => v ? `<div class="bk-row"><span><i class="fa-solid ${i}"></i> ${l}</span><b>${v}</b></div>` : "";
  const what = d.itemType === "Doctor" ? "Doctor" : d.itemType === "Home Collection" ? "Service" : "Test / Package";
  const wa = `https://wa.me/91${C.labInfo.whatsapp}?text=${encodeURIComponent(`Hello, my booking ref is ${d.ref} (${d.item} on ${d.dateFormatted}, ${d.slot}).`)}`;
  $("book-form").classList.add("hide");
  $("success").innerHTML = `
    <div class="ok"><i class="fa-solid fa-check"></i></div>
    <h3>Booking done successfully!</h3>
    <p class="headline">${headline}</p>
    <div class="when"><i class="fa-regular fa-calendar-check"></i><div><small>Booking date</small><b>${esc(d.dateFormatted)}</b><span>${esc(d.slot)}</span></div></div>
    <div class="bk">
      ${row("fa-clipboard-list", "Service", esc(d.service))}
      ${d.type === "home" ? "" : row("fa-vial", what, esc(d.item))}
      ${row("fa-user", "Patient", esc(d.name))}
      ${row("fa-phone", "Mobile", esc(d.phone))}
      ${row("fa-location-dot", "Address", esc([d.address, d.pincode].filter(Boolean).join(" - ")))}
      ${row("fa-note-sticky", d.type === "home" ? "Tests / notes" : "Enquiry", esc(d.enquiry))}
    </div>
    <div class="ref">Booking ref: ${esc(d.ref)}</div>
    ${USE_DUMMY_RESPONSE ? '<p class="demo-note"><i class="fa-solid fa-flask"></i> Test mode: this is a dummy success answer. The data is not saved to Google Sheet yet.</p>' : ""}
    <p class="meta">We will call <b>${esc(d.phone)}</b> to confirm. Please keep your booking ref handy.</p>
    <div class="row" style="justify-content:center;margin:12px 0 0"><a class="btn btn-primary" href="${wa}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Share on WhatsApp</a><button class="btn btn-outline" id="again" type="button">Make another booking</button></div>`;
  $("success").classList.remove("hide");
  $("again").onclick = () => setType(type);
  $("book-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function onFeedback(e) {
  e.preventDefault(); const a = $("fb-alert");
  if (!rating) { a.textContent = "Please select a star rating."; a.className = "alert err"; return; }
  const d = Object.fromEntries(new FormData(e.target)); d.rating = rating; d.type = "feedback";
  const r = { name: d.name, text: d.message, rating, date: "Just now" };
  try {
    const res = await send(d);
    if (res.status !== "success") throw new Error(res.message);
  } catch (err) { a.textContent = "Could not send your feedback. Please try again."; a.className = "alert err"; return; }
  reviews.unshift(r);
  try { localStorage.setItem("labReviews", JSON.stringify(reviews.filter(x => x.date === "Just now"))); } catch { }
  renderReviews(); e.target.reset(); rating = 0; [...$("stars").children].forEach(b => b.classList.remove("on"));
  a.textContent = "Thank you! Your feedback was sent successfully and is now live above." + (USE_DUMMY_RESPONSE ? " (Test mode: dummy answer, not saved to Google Sheet yet.)" : ""); a.className = "alert ok";
}

/* =====================================================================
   GOOGLE APPS SCRIPT  (paste in script.google.com, attached to your Google Sheet)
   Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone
   Copy the Web App URL into SCRIPT_URL at the top of this file.

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var isFb = d.type === "feedback";
    var name = isFb ? "Feedback" : "Bookings";
    var ss = SpreadsheetApp.getActive();
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = isFb
      ? ["timestamp", "name", "email", "rating", "message"]
      : ["timestamp", "ref", "service", "itemType", "item", "date", "dateFormatted", "slot", "name", "phone", "email", "address", "pincode", "enquiry", "bookedOn"];
    if (sheet.getLastRow() === 0) sheet.appendRow(cols);
    sheet.appendRow(cols.map(function (c) { return d[c] === undefined ? "" : d[c]; }));
    return reply({ status: "success", message: "Saved", ref: d.ref || "" });
  } catch (err) {
    return reply({ status: "error", message: String(err) });
  }
}
function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
   ===================================================================== */
