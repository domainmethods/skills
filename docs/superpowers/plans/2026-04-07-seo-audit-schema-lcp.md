# SEO Audit: Schema Depth + LCP Checks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google rich result eligibility validation for 10 schema types and LCP performance analysis (full trace on homepage, lightweight checks on all pages) to the seo-audit skill.

**Architecture:** Extend the existing eval script → checker → report pipeline. The eval script (`seo-eval.js`) gains new fields (`schemaDetails`, `lcpCandidate` upgrade, `renderBlockingResources`). The checker (`check_seo.py`) gains new check functions. The SKILL.md gains an updated LCP trace step. The scoring rubric gets updated criteria.

**Tech Stack:** JavaScript (browser eval), Python 3.8+ (checker), Markdown (SKILL.md, rubric)

---

### Task 1: Extend seo-eval.js — Schema Details

**Files:**
- Modify: `seo-audit/scripts/seo-eval.js:216-263` (schema section)

- [ ] **Step 1: Add the `schemaDetails` extraction after the existing schema block**

In `seo-eval.js`, after the closing of the `r.schema` IIFE (line 263), add a new `r.schemaDetails` section. Insert this code between `r.schema = ...` and `r.og = ...`:

```javascript
  // --- Schema Details (for Google rich result eligibility checks) ---
  r.schemaDetails = (() => {
    const details = [];
    try {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent);
          const items = Array.isArray(data) ? data
            : data['@graph'] ? data['@graph'] : [data];
          // If @context is at the root (common with @graph), capture it
          const rootContext = data['@context'] || null;

          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const rawType = item['@type'];
            if (!rawType) continue;
            const types = Array.isArray(rawType) ? rawType : [rawType];
            const normType = t => t.replace(/^https?:\/\/schema\.org\//i, '');
            const props = Object.keys(item).filter(k => !k.startsWith('@'));
            const detail = {
              types: types.map(normType),
              properties: props,
              source: data['@graph'] ? `@graph[${idx}]` : 'root',
              context: item['@context'] || rootContext || null,
            };

            // Nested validation for known important sub-objects
            // Product.offers
            if (types.some(t => normType(t) === 'Product') && item.offers) {
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              detail.offersProperties = offers ? Object.keys(offers).filter(k => !k.startsWith('@')) : [];
            }
            // Event.location
            if (types.some(t => normType(t) === 'Event') && item.location) {
              const loc = Array.isArray(item.location) ? item.location[0] : item.location;
              detail.locationProperties = loc ? Object.keys(loc).filter(k => !k.startsWith('@')) : [];
              detail.locationType = loc ? (loc['@type'] || null) : null;
            }
            // Event.offers
            if (types.some(t => normType(t) === 'Event') && item.offers) {
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              detail.offersProperties = offers ? Object.keys(offers).filter(k => !k.startsWith('@')) : [];
            }
            // HowTo.step
            if (types.some(t => normType(t) === 'HowTo') && item.step) {
              const steps = Array.isArray(item.step) ? item.step : [item.step];
              detail.stepCount = steps.length;
              detail.stepsHaveNameAndText = steps.every(st =>
                (st.name || st.text) || (st.itemListElement && st.itemListElement.length > 0)
              );
            }
            // FAQPage.mainEntity — validate questions have acceptedAnswer
            if (types.some(t => normType(t) === 'FAQPage') && item.mainEntity) {
              const questions = Array.isArray(item.mainEntity) ? item.mainEntity : [item.mainEntity];
              detail.questionCount = questions.length;
              detail.questionsHaveAnswers = questions.every(q => q.acceptedAnswer);
            }
            // BreadcrumbList.itemListElement — validate items have position+name+item
            if (types.some(t => normType(t) === 'BreadcrumbList') && item.itemListElement) {
              const items = Array.isArray(item.itemListElement) ? item.itemListElement : [item.itemListElement];
              detail.breadcrumbItemCount = items.length;
              detail.breadcrumbItemsValid = items.every(i => i.position && i.name && i.item);
            }

            details.push(detail);
          }
        } catch (e) { /* skip unparseable blocks */ }
      }
    } catch (e) { /* best effort */ }
    return details;
  })();
```

- [ ] **Step 2: Verify the script is valid JavaScript**

Run the eval script through a syntax check:

```bash
node -c seo-audit/scripts/seo-eval.js
```

Expected: no syntax errors. Note: the file is a bare function expression `() => { ... }`, so node may warn — wrap in a quick check:

```bash
node -e "const fn = $(cat seo-audit/scripts/seo-eval.js); console.log('syntax OK');"
```

Expected output: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add seo-audit/scripts/seo-eval.js
git commit -m "feat(seo-audit): add schemaDetails extraction for rich result eligibility"
```

---

### Task 2: Extend seo-eval.js — LCP Candidate + Render-Blocking

**Files:**
- Modify: `seo-audit/scripts/seo-eval.js:334-417` (cwvIndicators and resources sections)

- [ ] **Step 1: Replace the `lcpCandidate` heuristic with PerformanceObserver-based detection**

In the `r.cwvIndicators` section (starting around line 335), replace the `lcpCandidate` block (lines 356-371) with:

```javascript
    // LCP candidate — use PerformanceObserver if available, fall back to heuristic
    let lcpCandidate = null;
    try {
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries && lcpEntries.length > 0) {
        const lastEntry = lcpEntries[lcpEntries.length - 1];
        const el = lastEntry.element;
        if (el) {
          const isImg = el.tagName === 'IMG' || (el.tagName === 'VIDEO' && el.poster);
          const src = el.src || el.currentSrc || el.poster || '';
          lcpCandidate = {
            element: el.tagName.toLowerCase(),
            selector: el.id ? `#${el.id}` : (el.className ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}` : el.tagName.toLowerCase()),
            url: src.substring(0, 200),
            isLazy: el.loading === 'lazy' || el.hasAttribute('data-src') || el.hasAttribute('data-lazy-src') || el.classList.contains('lazyload'),
            hasFetchpriority: el.fetchPriority === 'high',
            hasPreload: !!document.querySelector(`link[rel="preload"][href="${src.split('?')[0]}"], link[rel="preload"][href="${src}"]`),
            isText: !isImg,
            renderTime: lastEntry.renderTime || lastEntry.startTime,
          };
        }
      }
      // Fallback: heuristic if PerformanceObserver didn't capture
      if (!lcpCandidate) {
        const heroImg = document.querySelector('img[fetchpriority="high"]') ||
          document.querySelector('[class*="hero"] img') ||
          document.querySelector('main img:first-of-type');
        if (heroImg) {
          const src = heroImg.src || heroImg.currentSrc || '';
          lcpCandidate = {
            element: 'img',
            selector: heroImg.id ? `#${heroImg.id}` : (heroImg.className ? `img.${heroImg.className.split(' ')[0]}` : 'img'),
            url: src.substring(0, 200),
            isLazy: heroImg.loading === 'lazy' || heroImg.hasAttribute('data-src') || heroImg.hasAttribute('data-lazy-src') || heroImg.classList.contains('lazyload'),
            hasFetchpriority: heroImg.fetchPriority === 'high',
            hasPreload: !!document.querySelector(`link[rel="preload"][href="${src.split('?')[0]}"], link[rel="preload"][href="${src}"]`),
            isText: false,
            renderTime: null,
          };
        }
      }
    } catch (e) { /* best effort */ }
```

Also update the return object to use the new `lcpCandidate` (it already references it, so no change needed there).

- [ ] **Step 2: Enhance the render-blocking detection in `r.resources`**

In the `r.resources` section (around line 386), update the `renderBlocking` array to return objects instead of just URLs. Replace the `renderBlocking` mapping:

```javascript
    // Render-blocking: scripts in <head> without async/defer
    const renderBlocking = scripts.filter(s =>
      s.parentElement && s.parentElement.tagName === 'HEAD' &&
      s.src &&
      !s.async && !s.defer &&
      s.type !== 'application/ld+json' &&
      s.type !== 'application/json' &&
      s.type !== 'module'
    ).map(s => ({ tag: 'script', src: s.src.substring(0, 200), hasAsync: false, hasDefer: false }));

    // Render-blocking stylesheets (no media query or media="all")
    const blockingCSSList = stylesheets.filter(l => {
      const media = l.media;
      return !media || media === 'all' || media === '';
    }).map(l => ({ tag: 'link', href: (l.href || '').substring(0, 200), media: l.media || 'all' }));
```

Update the return object to include both:

```javascript
    return {
      totalScripts: scripts.filter(s => s.src || s.textContent.trim().length > 10).length,
      externalScripts: scripts.filter(s => s.src).length,
      inlineScriptCount: scripts.filter(s => !s.src && s.textContent.trim().length > 10).length,
      totalStylesheets: stylesheets.length,
      inlineStyleCount: inlineStyles.length,
      renderBlockingScripts: renderBlocking.slice(0, 10),
      renderBlockingScriptCount: renderBlocking.length,
      blockingCSSCount: blockingCSSList.length,
      renderBlockingResources: [...renderBlocking, ...blockingCSSList].slice(0, 15),
    };
```

- [ ] **Step 3: Syntax check**

```bash
node -e "const fn = $(cat seo-audit/scripts/seo-eval.js); console.log('syntax OK');"
```

Expected: `syntax OK`

- [ ] **Step 4: Commit**

```bash
git add seo-audit/scripts/seo-eval.js
git commit -m "feat(seo-audit): upgrade LCP candidate detection and render-blocking detail"
```

---

### Task 3: Add Schema Eligibility Checks to check_seo.py

**Files:**
- Modify: `seo-audit/scripts/check_seo.py`

- [ ] **Step 1: Write test cases for schema eligibility checks**

Create a test file:

```bash
cat > /tmp/test_schema_eligibility.py << 'PYEOF'
import json
import sys
sys.path.insert(0, 'seo-audit/scripts')
from check_seo import run_checks

def make_page(url="https://example.com/test", schema_details=None, **kwargs):
    page = {
        "url": url,
        "title": "Test Page",
        "titleLength": 10,
        "description": "A test page",
        "descriptionLength": 11,
        "schema": {"jsonLdTypes": [], "jsonLdRaw": [], "microdataTypes": [],
                    "hasOrganization": False, "hasWebSite": False, "hasBreadcrumb": False,
                    "hasArticle": False, "hasFaqPage": False, "hasProduct": False, "hasService": False},
        "schemaDetails": schema_details or [],
        "schemaValidation": {"issues": []},
    }
    page.update(kwargs)
    return page

# Test 1: Product missing offers.price -> critical
page = make_page(schema_details=[{
    "types": ["Product"],
    "properties": ["name", "image", "offers"],
    "offersProperties": ["availability"],  # missing price and priceCurrency
    "source": "root",
    "context": "https://schema.org",
}])
page["schema"]["jsonLdTypes"] = ["Product"]
page["schema"]["hasProduct"] = True
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "SCHEMA_PRODUCT_MISSING_REQUIRED_OFFERS_PRICE" in ids, f"Expected SCHEMA_PRODUCT_MISSING_REQUIRED_OFFERS_PRICE, got {ids}"
print("PASS: Product missing offers.price flagged as critical")

# Test 2: Article missing recommended dateModified -> moderate
page = make_page(schema_details=[{
    "types": ["Article"],
    "properties": ["headline", "author", "datePublished", "image"],
    "source": "root",
    "context": "https://schema.org",
}])
page["schema"]["jsonLdTypes"] = ["Article"]
page["schema"]["hasArticle"] = True
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "SCHEMA_ARTICLE_MISSING_RECOMMENDED_DATEMODIFIED" in ids, f"Expected SCHEMA_ARTICLE_MISSING_RECOMMENDED_DATEMODIFIED, got {ids}"
print("PASS: Article missing dateModified flagged as moderate")

# Test 3: HowTo missing required step -> critical
page = make_page(schema_details=[{
    "types": ["HowTo"],
    "properties": ["name"],
    "source": "root",
    "context": "https://schema.org",
}])
page["schema"]["jsonLdTypes"] = ["HowTo"]
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "SCHEMA_HOWTO_MISSING_REQUIRED_STEP" in ids, f"Expected SCHEMA_HOWTO_MISSING_REQUIRED_STEP, got {ids}"
print("PASS: HowTo missing step flagged as critical")

# Test 4: Event with all required fields -> no critical findings for Event
page = make_page(schema_details=[{
    "types": ["Event"],
    "properties": ["name", "startDate", "location"],
    "locationProperties": ["name", "address"],
    "locationType": "Place",
    "source": "root",
    "context": "https://schema.org",
}])
page["schema"]["jsonLdTypes"] = ["Event"]
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
event_critical = [i for i in ids if i.startswith("SCHEMA_EVENT_MISSING_REQUIRED")]
assert len(event_critical) == 0, f"Unexpected critical Event findings: {event_critical}"
print("PASS: Event with all required fields has no critical schema findings")

# Test 5: FAQPage questions without acceptedAnswer -> critical
page = make_page(schema_details=[{
    "types": ["FAQPage"],
    "properties": ["mainEntity"],
    "questionCount": 3,
    "questionsHaveAnswers": False,
    "source": "root",
    "context": "https://schema.org",
}])
page["schema"]["jsonLdTypes"] = ["FAQPage"]
page["schema"]["hasFaqPage"] = True
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "SCHEMA_FAQPAGE_MISSING_REQUIRED_ACCEPTEDANSWER" in ids, f"Expected SCHEMA_FAQPAGE_MISSING_REQUIRED_ACCEPTEDANSWER, got {ids}"
print("PASS: FAQPage without acceptedAnswer flagged as critical")

# Test 6: BreadcrumbList items missing position/name/item -> critical
page = make_page(schema_details=[{
    "types": ["BreadcrumbList"],
    "properties": ["itemListElement"],
    "breadcrumbItemCount": 3,
    "breadcrumbItemsValid": False,
    "source": "root",
    "context": "https://schema.org",
}])
page["schema"]["jsonLdTypes"] = ["BreadcrumbList"]
page["schema"]["hasBreadcrumb"] = True
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "SCHEMA_BREADCRUMB_MISSING_REQUIRED_ITEM_FIELDS" in ids, f"Expected SCHEMA_BREADCRUMB_MISSING_REQUIRED_ITEM_FIELDS, got {ids}"
print("PASS: BreadcrumbList with invalid items flagged as critical")

print("\nAll schema eligibility tests passed!")
PYEOF
python3 /tmp/test_schema_eligibility.py
```

Expected: all tests FAIL (functions don't exist yet).

- [ ] **Step 2: Implement `check_schema_eligibility` in check_seo.py**

Add this function before the `check_og_tags` function (around line 595). This replaces no existing code — it's a new function inserted between `check_schema_validation` and `check_og_tags`:

```python
def check_schema_eligibility(page, all_pages):
    """Google rich result eligibility: required + recommended properties."""
    findings = []
    url = page.get("url", "unknown")
    details = page.get("schemaDetails", [])

    if not details:
        return findings

    # --- Required property checks (critical) ---
    for item in details:
        types = item.get("types", [])
        props = item.get("properties", [])
        type_label = ", ".join(types)

        def _req(check_type, field, display_field=None):
            """Emit critical finding if required field is missing."""
            if not any(t.lower() == check_type.lower() for t in types):
                return
            if field not in props:
                fid = f"SCHEMA_{check_type.upper()}_MISSING_REQUIRED_{(display_field or field).upper()}"
                findings.append({
                    "id": fid,
                    "severity": "critical",
                    "title": f"{type_label} schema missing required '{display_field or field}'",
                    "detail": (
                        f"The {type_label} schema is missing the required '{display_field or field}' property. "
                        f"Without it, this page won't qualify for Google rich results. "
                        f"See https://developers.google.com/search/docs/appearance/structured-data"
                    ),
                    "page": url,
                })

        def _rec(check_type, field, display_field=None):
            """Emit moderate finding if recommended field is missing."""
            if not any(t.lower() == check_type.lower() for t in types):
                return
            if field not in props:
                fid = f"SCHEMA_{check_type.upper()}_MISSING_RECOMMENDED_{(display_field or field).upper()}"
                findings.append({
                    "id": fid,
                    "severity": "moderate",
                    "title": f"{type_label} schema missing recommended '{display_field or field}'",
                    "detail": (
                        f"The {type_label} schema would benefit from adding '{display_field or field}'. "
                        f"This property improves the quality and appearance of rich results."
                    ),
                    "page": url,
                })

        # Organization / LocalBusiness
        _req("Organization", "name")
        _req("Organization", "url")
        _rec("Organization", "logo")
        _rec("Organization", "sameAs")
        _rec("Organization", "contactPoint")
        _req("LocalBusiness", "name")
        _req("LocalBusiness", "address")
        _rec("LocalBusiness", "telephone")
        _rec("LocalBusiness", "openingHours")
        _rec("LocalBusiness", "geo")

        # Article / BlogPosting / NewsArticle
        for article_type in ("Article", "BlogPosting", "NewsArticle"):
            _req(article_type, "headline")
            _req(article_type, "author")
            _req(article_type, "datePublished")
            _req(article_type, "image")
            _rec(article_type, "dateModified")
            _rec(article_type, "publisher")
            _rec(article_type, "description")

        # Product
        _req("Product", "name")
        _req("Product", "offers")
        _rec("Product", "sku")
        _rec("Product", "brand")
        _rec("Product", "aggregateRating")
        # Product.offers sub-properties
        if any(t.lower() == "product" for t in types) and "offers" in props:
            offers_props = item.get("offersProperties", [])
            if "price" not in offers_props:
                findings.append({
                    "id": "SCHEMA_PRODUCT_MISSING_REQUIRED_OFFERS_PRICE",
                    "severity": "critical",
                    "title": f"{type_label} offers missing required 'price'",
                    "detail": "Product.offers must include 'price' for Google rich results.",
                    "page": url,
                })
            if "availability" not in offers_props:
                findings.append({
                    "id": "SCHEMA_PRODUCT_MISSING_REQUIRED_OFFERS_AVAILABILITY",
                    "severity": "critical",
                    "title": f"{type_label} offers missing required 'availability'",
                    "detail": "Product.offers must include 'availability' for Google rich results.",
                    "page": url,
                })
            if "priceCurrency" not in offers_props:
                findings.append({
                    "id": "SCHEMA_PRODUCT_MISSING_REQUIRED_OFFERS_PRICECURRENCY",
                    "severity": "moderate",
                    "title": f"{type_label} offers missing 'priceCurrency'",
                    "detail": "Product.offers should include 'priceCurrency' for correct price display.",
                    "page": url,
                })

        # FAQPage
        _req("FAQPage", "mainEntity")
        if any(t.lower() == "faqpage" for t in types) and "mainEntity" in props:
            if item.get("questionCount", 0) > 0 and not item.get("questionsHaveAnswers", True):
                findings.append({
                    "id": "SCHEMA_FAQPAGE_MISSING_REQUIRED_ACCEPTEDANSWER",
                    "severity": "critical",
                    "title": "FAQPage questions missing 'acceptedAnswer'",
                    "detail": "Each Question in FAQPage.mainEntity must have an acceptedAnswer for rich results.",
                    "page": url,
                })

        # BreadcrumbList
        _req("BreadcrumbList", "itemListElement")
        if any(t.lower() == "breadcrumblist" for t in types) and "itemListElement" in props:
            if item.get("breadcrumbItemCount", 0) > 0 and not item.get("breadcrumbItemsValid", True):
                findings.append({
                    "id": "SCHEMA_BREADCRUMB_MISSING_REQUIRED_ITEM_FIELDS",
                    "severity": "critical",
                    "title": "BreadcrumbList items missing position/name/item",
                    "detail": "Each BreadcrumbList item must have 'position', 'name', and 'item' (URL).",
                    "page": url,
                })

        # HowTo (new type)
        _req("HowTo", "name")
        _req("HowTo", "step")
        _rec("HowTo", "image")
        _rec("HowTo", "totalTime")
        if any(t.lower() == "howto" for t in types) and "step" in props:
            if not item.get("stepsHaveNameAndText", True):
                findings.append({
                    "id": "SCHEMA_HOWTO_STEPS_MISSING_NAME_OR_TEXT",
                    "severity": "critical",
                    "title": "HowTo steps missing name/text",
                    "detail": "Each HowTo step must have 'name' and 'text', or an 'itemListElement'.",
                    "page": url,
                })

        # Event (new type)
        _req("Event", "name")
        _req("Event", "startDate")
        _req("Event", "location")
        _rec("Event", "endDate")
        _rec("Event", "image")
        _rec("Event", "description")
        _rec("Event", "offers")

        # SoftwareApplication (new type)
        _req("SoftwareApplication", "name")
        _req("SoftwareApplication", "offers")
        _rec("SoftwareApplication", "applicationCategory")
        _rec("SoftwareApplication", "operatingSystem")
        _rec("SoftwareApplication", "aggregateRating")

    return findings
```

- [ ] **Step 3: Register the new check in PER_PAGE_CHECKS**

In the `PER_PAGE_CHECKS` list (around line 1218), add `check_schema_eligibility` after `check_schema_validation`:

```python
PER_PAGE_CHECKS = [
    check_http_status,
    check_title,
    check_description,
    check_canonical,
    check_h1,
    check_heading_hierarchy,
    check_images_alt,
    check_images_responsive,
    check_images_dimensions,
    check_lazy_loading,
    check_schema_markup,
    check_org_schema,
    check_breadcrumb_schema,
    check_schema_validation,
    check_schema_eligibility,  # NEW
    check_og_tags,
    check_twitter_card,
    check_noindex,
    check_viewport,
    check_mixed_content,
    check_thin_content,
    check_html_lang,
    check_render_blocking,
    check_broken_anchors,
]
```

- [ ] **Step 4: Run the tests**

```bash
python3 /tmp/test_schema_eligibility.py
```

Expected: `All schema eligibility tests passed!`

- [ ] **Step 5: Commit**

```bash
git add seo-audit/scripts/check_seo.py
git commit -m "feat(seo-audit): add Google rich result eligibility checks for 10 schema types"
```

---

### Task 4: Add LCP Checks to check_seo.py

**Files:**
- Modify: `seo-audit/scripts/check_seo.py`

- [ ] **Step 1: Write test cases for LCP checks**

```bash
cat > /tmp/test_lcp_checks.py << 'PYEOF'
import json
import sys
sys.path.insert(0, 'seo-audit/scripts')
from check_seo import run_checks

def make_page(url="https://example.com/", **kwargs):
    page = {
        "url": url,
        "title": "Test",
        "titleLength": 4,
        "schema": {"jsonLdTypes": [], "jsonLdRaw": [], "microdataTypes": [],
                    "hasOrganization": False, "hasWebSite": False, "hasBreadcrumb": False,
                    "hasArticle": False, "hasFaqPage": False, "hasProduct": False, "hasService": False},
        "schemaDetails": [],
        "schemaValidation": {"issues": []},
    }
    page.update(kwargs)
    return page

# Test 1: LCP candidate with loading="lazy" -> critical
page = make_page(cwvIndicators={
    "imagesWithoutDimensions": 0,
    "lcpCandidate": {
        "element": "img",
        "selector": "img.hero",
        "url": "/hero.jpg",
        "isLazy": True,
        "hasFetchpriority": False,
        "hasPreload": False,
        "isText": False,
        "renderTime": None,
    },
    "viewportMeta": "width=device-width",
    "hasViewportWidth": True,
})
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "LCP_LAZY_LOADED" in ids, f"Expected LCP_LAZY_LOADED, got {ids}"
print("PASS: Lazy-loaded LCP flagged as critical")

# Test 2: LCP image missing fetchpriority -> moderate
page = make_page(cwvIndicators={
    "imagesWithoutDimensions": 0,
    "lcpCandidate": {
        "element": "img",
        "selector": "img.hero",
        "url": "/hero.jpg",
        "isLazy": False,
        "hasFetchpriority": False,
        "hasPreload": False,
        "isText": False,
        "renderTime": None,
    },
    "viewportMeta": "width=device-width",
    "hasViewportWidth": True,
})
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "LCP_NO_FETCHPRIORITY" in ids, f"Expected LCP_NO_FETCHPRIORITY, got {ids}"
print("PASS: LCP missing fetchpriority flagged as moderate")

# Test 3: LCP image missing preload -> moderate
page = make_page(cwvIndicators={
    "imagesWithoutDimensions": 0,
    "lcpCandidate": {
        "element": "img",
        "selector": "img.hero",
        "url": "/hero.jpg",
        "isLazy": False,
        "hasFetchpriority": True,
        "hasPreload": False,
        "isText": False,
        "renderTime": None,
    },
    "viewportMeta": "width=device-width",
    "hasViewportWidth": True,
})
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "LCP_NO_PRELOAD" in ids, f"Expected LCP_NO_PRELOAD, got {ids}"
print("PASS: LCP missing preload flagged as moderate")

# Test 4: Text-based LCP should NOT flag fetchpriority/preload
page = make_page(cwvIndicators={
    "imagesWithoutDimensions": 0,
    "lcpCandidate": {
        "element": "h1",
        "selector": "h1.title",
        "url": "",
        "isLazy": False,
        "hasFetchpriority": False,
        "hasPreload": False,
        "isText": True,
        "renderTime": None,
    },
    "viewportMeta": "width=device-width",
    "hasViewportWidth": True,
})
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "LCP_NO_FETCHPRIORITY" not in ids, f"Text LCP should not flag fetchpriority: {ids}"
assert "LCP_NO_PRELOAD" not in ids, f"Text LCP should not flag preload: {ids}"
print("PASS: Text-based LCP correctly skips image-only checks")

# Test 5: Many render-blocking resources -> moderate
page = make_page(resources={
    "totalScripts": 10,
    "externalScripts": 8,
    "inlineScriptCount": 2,
    "totalStylesheets": 5,
    "inlineStyleCount": 1,
    "renderBlockingScripts": [{"tag": "script", "src": f"/js/vendor{i}.js"} for i in range(4)],
    "renderBlockingScriptCount": 4,
    "blockingCSSCount": 3,
    "renderBlockingResources": [{"tag": "script"} for _ in range(4)] + [{"tag": "link"} for _ in range(3)],
})
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "EXCESSIVE_RENDER_BLOCKING" in ids, f"Expected EXCESSIVE_RENDER_BLOCKING, got {ids}"
print("PASS: Excessive render-blocking resources flagged")

# Test 6: LCP trace with poor rating -> critical (homepage only)
page = make_page(
    url="https://example.com/",
    lcpTrace={
        "totalLcp": 4.5,
        "ttfb": 1.2,
        "resourceLoadDelay": 1.5,
        "resourceLoadDuration": 1.2,
        "elementRenderDelay": 0.6,
        "bottleneck": "resourceLoadDelay",
        "lcpElement": "img.hero",
        "lcpResourceUrl": "/hero.jpg",
        "rating": "poor",
    },
)
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "LCP_POOR" in ids, f"Expected LCP_POOR, got {ids}"
print("PASS: Poor LCP rating flagged as critical on homepage")

# Test 7: LCP trace on non-homepage should be ignored
page = make_page(
    url="https://example.com/about",
    lcpTrace={
        "totalLcp": 4.5,
        "rating": "poor",
        "bottleneck": "ttfb",
    },
)
result = run_checks([page])
ids = [f["id"] for f in result["findings"]]
assert "LCP_POOR" not in ids, f"LCP trace on non-homepage should be ignored: {ids}"
print("PASS: LCP trace correctly ignored on non-homepage")

print("\nAll LCP check tests passed!")
PYEOF
python3 /tmp/test_lcp_checks.py
```

Expected: all tests FAIL (functions don't exist yet).

- [ ] **Step 2: Implement LCP check functions**

Add these functions in `check_seo.py` after `check_broken_anchors` (around line 903) and before the cross-page checks section:

```python
def check_lcp_lazy(page, all_pages):
    """LCP candidate element has loading='lazy' — delays the most important paint."""
    findings = []
    url = page.get("url", "unknown")
    cwv = page.get("cwvIndicators", {})
    lcp = cwv.get("lcpCandidate")

    if not lcp or lcp.get("isText"):
        return findings

    if lcp.get("isLazy"):
        findings.append({
            "id": "LCP_LAZY_LOADED",
            "severity": "critical",
            "title": "LCP image has loading=\"lazy\" — delays largest paint",
            "detail": (
                f"Element: {lcp.get('selector', 'unknown')} ({lcp.get('url', '')})\n"
                "The Largest Contentful Paint element is set to lazy-load, which tells "
                "the browser to deprioritize it. This directly delays LCP because the "
                "browser won't start fetching the image until it's near the viewport. "
                "Remove loading=\"lazy\" from the LCP image and add fetchpriority=\"high\" instead."
            ),
            "page": url,
        })
    return findings


def check_lcp_fetchpriority(page, all_pages):
    """LCP image missing fetchpriority='high'."""
    findings = []
    url = page.get("url", "unknown")
    cwv = page.get("cwvIndicators", {})
    lcp = cwv.get("lcpCandidate")

    if not lcp or lcp.get("isText") or lcp.get("isLazy"):
        return findings

    if not lcp.get("hasFetchpriority"):
        findings.append({
            "id": "LCP_NO_FETCHPRIORITY",
            "severity": "moderate",
            "title": "LCP image missing fetchpriority=\"high\"",
            "detail": (
                f"Element: {lcp.get('selector', 'unknown')} ({lcp.get('url', '')})\n"
                "Adding fetchpriority=\"high\" to the LCP image tells the browser to "
                "prioritize this resource over other images and non-critical resources. "
                "This reduces the resource load delay subpart of LCP."
            ),
            "page": url,
        })
    return findings


def check_lcp_preload(page, all_pages):
    """LCP image resource not preloaded."""
    findings = []
    url = page.get("url", "unknown")
    cwv = page.get("cwvIndicators", {})
    lcp = cwv.get("lcpCandidate")

    if not lcp or lcp.get("isText") or not lcp.get("url"):
        return findings

    if not lcp.get("hasPreload"):
        findings.append({
            "id": "LCP_NO_PRELOAD",
            "severity": "moderate",
            "title": "LCP resource not preloaded",
            "detail": (
                f"Element: {lcp.get('selector', 'unknown')} ({lcp.get('url', '')})\n"
                "The LCP resource has no matching <link rel=\"preload\">. If the LCP image "
                "isn't discoverable in the initial HTML (e.g., it's set via CSS background-image "
                "or loaded by JavaScript), a preload hint eliminates the resource load delay. "
                "Add: <link rel=\"preload\" as=\"image\" href=\"{url}\" fetchpriority=\"high\">"
            ),
            "page": url,
        })
    return findings


def check_render_blocking_count(page, all_pages):
    """Excessive render-blocking resources in <head>."""
    findings = []
    url = page.get("url", "unknown")
    resources = page.get("resources", {})

    # Use the new renderBlockingResources array if available, fall back to count
    blocking = resources.get("renderBlockingResources", [])
    count = len(blocking) if blocking else (
        resources.get("renderBlockingScriptCount", 0) + resources.get("blockingCSSCount", 0)
    )

    if count > 3:
        findings.append({
            "id": "EXCESSIVE_RENDER_BLOCKING",
            "severity": "moderate",
            "title": f"{count} render-blocking resources in <head>",
            "detail": (
                f"Found {count} resources that block rendering: scripts without async/defer "
                "and stylesheets without a limiting media attribute. Each blocks the browser "
                "from rendering content until it's downloaded and parsed. This increases the "
                "element render delay subpart of LCP. Consider adding async/defer to scripts "
                "and using media queries on non-critical stylesheets."
            ),
            "page": url,
        })
    return findings


def check_lcp_trace(page, all_pages):
    """Homepage LCP trace results — flag poor/needs-improvement ratings."""
    findings = []
    url = page.get("url", "unknown")

    # Only process homepage LCP trace data
    if not _is_homepage(url):
        return findings

    trace = page.get("lcpTrace")
    if not trace:
        return findings

    rating = trace.get("rating", "")
    total = trace.get("totalLcp", 0)
    bottleneck = trace.get("bottleneck", "unknown")

    bottleneck_labels = {
        "ttfb": "Time to First Byte (server response time)",
        "resourceLoadDelay": "Resource Load Delay (browser didn't start loading the LCP resource quickly enough)",
        "resourceLoadDuration": "Resource Load Duration (the LCP resource file is too large or server is slow)",
        "elementRenderDelay": "Element Render Delay (resource downloaded but rendering was blocked)",
    }
    bottleneck_desc = bottleneck_labels.get(bottleneck, bottleneck)

    if rating == "poor":
        findings.append({
            "id": "LCP_POOR",
            "severity": "critical",
            "title": f"LCP is {total:.1f}s (poor — target: ≤2.5s)",
            "detail": (
                f"The homepage Largest Contentful Paint is {total:.1f} seconds, rated 'poor' "
                f"by Core Web Vitals standards (>4.0s). The primary bottleneck is: "
                f"{bottleneck_desc}. This directly impacts search ranking and user experience."
            ),
            "page": url,
        })
    elif rating == "needs-improvement":
        findings.append({
            "id": "LCP_NEEDS_IMPROVEMENT",
            "severity": "moderate",
            "title": f"LCP is {total:.1f}s (needs improvement — target: ≤2.5s)",
            "detail": (
                f"The homepage LCP is {total:.1f} seconds, between 2.5s and 4.0s. "
                f"The primary bottleneck is: {bottleneck_desc}. "
                f"Optimizing this subpart would bring LCP into the 'good' range."
            ),
            "page": url,
        })

    return findings
```

- [ ] **Step 3: Register the new checks in PER_PAGE_CHECKS**

Add the LCP checks after `check_broken_anchors`:

```python
PER_PAGE_CHECKS = [
    check_http_status,
    check_title,
    check_description,
    check_canonical,
    check_h1,
    check_heading_hierarchy,
    check_images_alt,
    check_images_responsive,
    check_images_dimensions,
    check_lazy_loading,
    check_schema_markup,
    check_org_schema,
    check_breadcrumb_schema,
    check_schema_validation,
    check_schema_eligibility,
    check_og_tags,
    check_twitter_card,
    check_noindex,
    check_viewport,
    check_mixed_content,
    check_thin_content,
    check_html_lang,
    check_render_blocking,
    check_broken_anchors,
    check_lcp_lazy,           # NEW
    check_lcp_fetchpriority,  # NEW
    check_lcp_preload,        # NEW
    check_render_blocking_count,  # NEW
    check_lcp_trace,          # NEW
]
```

- [ ] **Step 4: Run the tests**

```bash
python3 /tmp/test_lcp_checks.py
```

Expected: `All LCP check tests passed!`

- [ ] **Step 5: Run both test suites to confirm no regressions**

```bash
python3 /tmp/test_schema_eligibility.py && python3 /tmp/test_lcp_checks.py
```

Expected: Both pass.

- [ ] **Step 6: Commit**

```bash
git add seo-audit/scripts/check_seo.py
git commit -m "feat(seo-audit): add LCP performance and render-blocking checks"
```

---

### Task 5: Update Scoring Rubric

**Files:**
- Modify: `seo-audit/references/scoring-rubric.md`

- [ ] **Step 1: Update the Schema & Structured Data scoring criteria**

Replace the existing "Schema & Structured Data" section (lines 25-33) with:

```markdown
## Schema & Structured Data — Weight: 15%

| Score | Criteria |
|-------|----------|
| 9-10 | JSON-LD for Organization (homepage), BreadcrumbList (interior pages), and page-specific types (Article, Product, FAQ, HowTo, Event, SoftwareApplication). All schema has required AND most recommended properties per Google rich result eligibility. |
| 7-8 | Schema present with all required properties for detected types. Some recommended properties missing. Minor gaps in page-specific types. |
| 5-6 | Basic schema present (e.g., Organization only) but missing page-specific types. Or schema present but missing required properties (won't qualify for rich results). |
| 3-4 | Only itemtype on `<html>` tag (minimal Microdata). No JSON-LD. Or JSON-LD present but invalid/incomplete. |
| 1-2 | No structured data at all. |
```

- [ ] **Step 2: Update the Core Web Vitals & Performance scoring criteria**

Replace the existing "Core Web Vitals & Performance" section (lines 35-43) with:

```markdown
## Core Web Vitals & Performance — Weight: 15%

| Score | Criteria |
|-------|----------|
| 9-10 | LCP ≤2.5s (if traced), LCP image not lazy-loaded, fetchpriority="high" on LCP image, LCP resource preloaded, all images have dimensions, responsive images with srcset, ≤3 render-blocking resources. |
| 7-8 | LCP ≤2.5s or not traced but no critical LCP issues. Most images sized. Missing fetchpriority or preload (but not both). Moderate render-blocking (4-5 resources). |
| 5-6 | LCP 2.5-4.0s (needs improvement). Many images without dimensions. No fetchpriority. Several render-blocking resources. No responsive images. |
| 3-4 | LCP >4.0s (poor) or LCP image lazy-loaded. Significant CLS risks. Heavy render-blocking (>6 resources). |
| 1-2 | Multiple critical LCP issues: lazy-loaded LCP, no fetchpriority, many render-blocking resources, poor LCP rating. |
```

- [ ] **Step 3: Commit**

```bash
git add seo-audit/references/scoring-rubric.md
git commit -m "docs(seo-audit): update scoring rubric for schema eligibility and LCP checks"
```

---

### Task 6: Update SKILL.md — LCP Trace Step + Report Template

**Files:**
- Modify: `seo-audit/SKILL.md`

- [ ] **Step 1: Update the Step 2 key table to include new fields**

In the Step 2 table (around lines 79-102), add new rows for the new eval fields. After the `cwvIndicators` row, update it and add the new `schemaDetails` row:

Add after the `schema` row:
```markdown
| `schemaDetails` | Per-type property lists for Google rich result eligibility validation |
```

Update the `cwvIndicators` row to:
```markdown
| `cwvIndicators` | Images without dimensions (CLS risk), LCP candidate (element, lazy status, fetchpriority, preload), viewport meta |
```

Add after the `resources` row or update it to:
```markdown
| `resources` | Script/stylesheet counts, render-blocking resources (scripts + CSS with detail) |
```

- [ ] **Step 2: Replace the optional performance trace in Step 3 with a structured LCP trace step**

Replace the Step 3 section (lines 106-125) with:

```markdown
#### Step 3: Collect supplementary data

After the eval script runs:

1. **Network requests** (for HTTP header data):
   ```
   list_network_requests → resourceTypes: ["document"]
   ```
   Check for X-Robots-Tag in response headers (some sites use HTTP headers instead of meta tags for noindex).

2. **LCP Performance Trace** (homepage only):
   On the homepage, run a full performance trace to get LCP subpart timing:
   ```
   performance_start_trace → reload: true, autoStop: true
   ```
   After the trace completes, analyze LCP insights:
   ```
   performance_analyze_insight → insightName: "LCPBreakdown"
   performance_analyze_insight → insightName: "RenderBlocking"
   ```
   Extract the four LCP subparts (TTFB, resource load delay, resource load duration, element render delay) and identify the bottleneck. Save as `lcpTrace` in the page JSON:
   ```json
   {
     "lcpTrace": {
       "totalLcp": 2.8,
       "ttfb": 0.9,
       "resourceLoadDelay": 0.6,
       "resourceLoadDuration": 1.0,
       "elementRenderDelay": 0.3,
       "bottleneck": "resourceLoadDelay",
       "lcpElement": "img.hero-banner",
       "lcpResourceUrl": "/images/hero.webp",
       "rating": "needs-improvement"
     }
   }
   ```
   Rating thresholds: `good` (≤2.5s), `needs-improvement` (2.5–4.0s), `poor` (>4.0s).

   **If the trace times out or fails**, skip it — the lightweight LCP checks from the eval script still run on all pages.

   **On non-homepage pages**, skip the trace. The eval script's `lcpCandidate` field provides lightweight LCP checks (lazy loading, fetchpriority, preload) without the overhead of a full trace.
```

- [ ] **Step 3: Add LCP section to the report template**

In the Phase 4 report template (around line 159), add an LCP section after the Issues Found section and before the Scoring section. Insert:

```markdown
## LCP Performance (Homepage)

*Include this section only if an LCP trace was collected on the homepage.*

| Subpart | Time | % of LCP | Target | Status |
|---------|------|----------|--------|--------|
| TTFB | X.Xs | XX% | ~40% | OK/High |
| Resource Load Delay | X.Xs | XX% | <10% | OK/High |
| Resource Load Duration | X.Xs | XX% | ~40% | OK/High |
| Element Render Delay | X.Xs | XX% | <10% | OK/High |
| **Total LCP** | **X.Xs** | | ≤2.5s | Good/Needs Work/Poor |

**LCP Element:** `<element description>`
**Bottleneck:** [subpart name] — [one-sentence remediation]
```

- [ ] **Step 4: Commit**

```bash
git add seo-audit/SKILL.md
git commit -m "docs(seo-audit): add LCP trace step and report template, document new eval fields"
```

---

### Task 7: Final Validation

**Files:**
- Read: all modified files

- [ ] **Step 1: Run both test suites one final time**

```bash
python3 /tmp/test_schema_eligibility.py && python3 /tmp/test_lcp_checks.py
```

Expected: both pass.

- [ ] **Step 2: Syntax-check the eval script**

```bash
node -e "const fn = $(cat seo-audit/scripts/seo-eval.js); console.log('syntax OK');"
```

Expected: `syntax OK`

- [ ] **Step 3: Run the checker with the existing test fixtures (if any)**

```bash
ls seo-audit/evals/ 2>/dev/null && python3 seo-audit/scripts/check_seo.py --dir seo-audit/evals/ --pretty | head -20 || echo "No eval fixtures — skip"
```

- [ ] **Step 4: Verify check count increased**

```bash
python3 -c "
import sys; sys.path.insert(0, 'seo-audit/scripts')
from check_seo import PER_PAGE_CHECKS, CROSS_PAGE_CHECKS
print(f'Per-page checks: {len(PER_PAGE_CHECKS)}')
print(f'Cross-page checks: {len(CROSS_PAGE_CHECKS)}')
print(f'Total: {len(PER_PAGE_CHECKS) + len(CROSS_PAGE_CHECKS)}')
"
```

Expected: Per-page checks should be 29 (was 23, added 6: schema_eligibility + 5 LCP checks). Cross-page stays at 8. Total: 37.

- [ ] **Step 5: Clean up test files**

```bash
rm /tmp/test_schema_eligibility.py /tmp/test_lcp_checks.py
```

- [ ] **Step 6: Commit any remaining changes**

If any files were adjusted during validation:

```bash
git add -A seo-audit/
git commit -m "fix(seo-audit): validation fixes from final review"
```
