# MathBoard — Browser Testing Guide

This guide provides detailed test procedures for verifying MathBoard functionality before launch.

## Prerequisites

1. **Server running**: `cd mathboard && python3 -m http.server 8080`
2. **Chrome or Safari** with DevTools open
3. **Clean state**: Clear all site data before each test suite

---

## Test Suite 1: Fresh Profile Smoke Test (P0-1)

### Setup
1. Open Chrome DevTools (⌥⌘I)
2. Navigate to **Application** → **Storage** → **Clear site data**
3. Navigate to `http://127.0.0.1:8080`
4. Keep **Console** tab visible

### Test Steps

#### 1.1 Initial Load
- [ ] Library view displays
- [ ] No red boot error banner
- [ ] Console: zero errors
- [ ] Footer shows version (v74)

#### 1.2 Create Lesson
- [ ] Click **+ New lesson**
- [ ] Dialog appears, enter name: "Test Lesson"
- [ ] Click Create
- [ ] Editor view opens, canvas renders
- [ ] Console: zero errors

#### 1.3 Drawing Tools
- [ ] Select **Pen** tool, draw stroke on canvas
- [ ] Click **Undo** → stroke disappears
- [ ] Click **Redo** → stroke reappears
- [ ] Console: zero errors

#### 1.4 Equation (LaTeX)
- [ ] Add equation (may be in Maths tab)
- [ ] MathLive editor appears
- [ ] Type: `x^2 + 3x + 2`
- [ ] Equation renders on page
- [ ] Console: zero errors

#### 1.5 Panel Tests

**Open each panel and verify no errors:**

- [ ] **Layers**: Opens, shows layer list
- [ ] **f(x)**: Opens, add `sin(x)`, graph renders
- [ ] **Calculus**: Opens, UI controls visible
- [ ] **Symbolic**: Opens, Nerdamer controls visible
- [ ] **Algebra**: Opens, Mathjs controls visible
- [ ] **Fractions**: Opens, fraction controls visible
- [ ] **Statistics** ⭐: Opens, enter data `12,15,15,18,20,21,24`, run, box plot renders, normal curve renders, **Place** button adds chart to page
- [ ] **Calculator**: Opens, fx-991ES faceplate, enter `2+3=`, result `5`
- [ ] **Mechanics**: Opens, diagrams available
- [ ] **Complex**: Opens, Argand controls visible
- [ ] **Instruments**: Ruler/protractor/compass available
- [ ] **AR Studio**: Opens (camera permission may be requested)

#### 1.6 Export Tests
- [ ] Click **Export PDF**, PDF downloads, open PDF to verify
- [ ] Export page as PNG, PNG downloads, open to verify
- [ ] Console: zero errors

#### 1.7 Persistence Test
- [ ] Note lesson name
- [ ] Reload page (⌘R)
- [ ] Lesson appears in library list
- [ ] Open lesson, all strokes/objects still present
- [ ] Console: zero errors

### Expected Result
✅ All steps pass with **ZERO console errors**

---

## Test Suite 2: PDF Import/Export Round-Trip (P0-2)

### Prerequisites
A multi-page PDF file (10-20 pages recommended)

### Test Steps

#### 2.1 Import PDF
- [ ] Click **Import PDF**, select multi-page PDF
- [ ] Wait for import, editor opens with PDF as background
- [ ] Navigate through pages → PDF backgrounds render

#### 2.2 Verify JSON Size
- [ ] DevTools → Application → IndexedDB → `mathboard` → `notebooks`
- [ ] Find imported notebook, check `value` column
- [ ] Verify: JSON is small (<1MB), no base64 inlined, blob references present

#### 2.3 Annotate Pages
- [ ] Page 1: draw annotation, add text/equation
- [ ] Last page: draw different annotation, add different text

#### 2.4 Export
- [ ] Click **Export PDF**, PDF downloads
- [ ] Open in Preview/Acrobat
- [ ] Page 1 annotations present ✓
- [ ] Last page annotations present ✓

### Expected Result
✅ PDF stored as blob references, annotations export correctly

---

## Test Suite 3: Optional config.local.js (P0-3)

- [ ] Ensure `config.local.js` does NOT exist (or rename temporarily)
- [ ] Hard refresh (⌘⇧R)
- [ ] App loads normally, no red boot banner
- [ ] Console may show 404 for config.local.js (acceptable)
- [ ] App functions normally

### Expected Result
✅ App gracefully handles missing config.local.js

---

## Test Suite 4: Service Worker / PWA Offline (P0-4)

### Prerequisites
Server accessible from LAN IP

### Test Steps

#### 4.1 Access from Another Device
- [ ] Find Mac LAN IP: System Settings → Wi-Fi → Details
- [ ] iPad Safari: `http://192.168.1.24:8080`
- [ ] App loads, create/open lesson

#### 4.2 Install PWA
- [ ] Safari Share → **Add to Home Screen**
- [ ] Close Safari, launch from home screen
- [ ] App opens full-screen

#### 4.3 Test Offline
- [ ] Enable Airplane Mode
- [ ] Close app, re-open from home screen
- [ ] App loads, can draw in existing lesson

#### 4.4 Verify Service Worker
- [ ] DevTools → Application → Service Workers → **Activated**
- [ ] Cache Storage → `mathboard-v74` present

### Expected Result
✅ App installs as PWA and works fully offline

---

## Reporting Issues

If any test fails, document:
1. Which test step failed
2. Expected vs actual behavior
3. Console errors (full stack trace)
4. Browser and version
5. Screenshots if visual issue

---

## Success Criteria

Project is **launch-ready** when:
- [ ] Test Suite 1 (Smoke): **100% pass**
- [ ] Test Suite 2 (PDF): **100% pass**
- [ ] Test Suite 3 (config): **100% pass**
- [ ] Test Suite 4 (PWA): **100% pass** OR documented
- [ ] **ZERO console errors** in all successful flows
